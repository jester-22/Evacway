import { useEffect, useRef, useState } from "react";
import { api } from "../services/api";
import "../components_css/BarangayManager.css";
import "../components_css/BarangayManager.motion.css";
import FamilyManagement from "./FamilyManagement";
import LoadingState from "./LoadingState";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
  faPlus,
  faRotate,
  faTriangleExclamation,
  faArrowLeft,
  faUsers,
  faLocationDot,
  faArrowRight,
  faUpload,
  faFileExcel,
  faXmark,
  faCircleCheck,
  faUser,
  faPhone,
  faHouse,
  faMapLocationDot,
  faPeopleGroup,
  faShieldHeart,
  faBuilding,
  faDoorOpen,
  faChevronDown,
  faChevronUp,
  faMagnifyingGlass,
  faDownload,
  faTableList,
  faGrip,
} from "@fortawesome/free-solid-svg-icons";

function BarangayManager() {
  const [barangays, setBarangays] = useState([]);
  const [selectedBarangay, setSelectedBarangay] = useState(null);
  const [selectedFamily, setSelectedFamily] = useState(null);
  const [workspaceTab, setWorkspaceTab] = useState("barangays");

  const [activeTab, setActiveTab] = useState("residents");

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  // Search, filter, view mode and pagination
  const [barangaySearch, setBarangaySearch] = useState("");
  const [viewMode, setViewMode] = useState("table");
  const [brgyPage, setBrgyPage] = useState(1);
  const [residentSearch, setResidentSearch] = useState("");
  const [residentPage, setResidentPage] = useState(1);

  // NEW: loading states for on-demand data
  const [detailLoading, setDetailLoading] = useState(false);
  const [centers, setCenters] = useState(null); // null = not loaded yet
  const [centersLoading, setCentersLoading] = useState(false);
  const [membersLoading, setMembersLoading] = useState(false);

  const [showImport, setShowImport] = useState(false);
  const [selectedFile, setSelectedFile] = useState(null);
  const [importing, setImporting] = useState(false);
  const [importMessage, setImportMessage] = useState("");

  const [expandedRooms, setExpandedRooms] = useState({});

  const fileInputRef = useRef(null);

  useEffect(() => {
    loadBarangays();
  }, []);

  // NEW: load evacuation centers only the first time the tab is opened
  useEffect(() => {
    if (
      activeTab !== "centers" ||
      !selectedBarangay ||
      centers !== null
    ) {
      return;
    }

    let cancelled = false;

    setCentersLoading(true);

    api
      .getBarangayEvacuationCenters(selectedBarangay.id)
      .then((data) => {
        if (!cancelled) {
          setCenters(Array.isArray(data) ? data : []);
        }
      })
      .catch((err) => {
        if (!cancelled) {
          console.error("Failed to load evacuation centers:", err);
          setError(err.message || "Failed to load evacuation centers.");
          setCenters([]);
        }
      })
      .finally(() => {
        if (!cancelled) {
          setCentersLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [activeTab, selectedBarangay, centers]);

  async function loadBarangays() {
    try {
      setLoading(true);
      setError("");

      const data = await api.getBarangays();

      setBarangays(Array.isArray(data) ? data : []);
    } catch (err) {
      console.error("Failed to load barangays:", err);
      setError(err.message || "Failed to load barangays.");
    } finally {
      setLoading(false);
    }
  }

  async function openBarangay(id) {
    try {
      setWorkspaceTab("barangays");
      setError("");
      setDetailLoading(true);

      const data = await api.getBarangay(id);

      setSelectedBarangay(data);
      setCenters(null);
      setActiveTab("residents");
      setExpandedRooms({});
    } catch (err) {
      console.error("Failed to load barangay:", err);
      setError(err.message || "Failed to load barangay.");
    } finally {
      setDetailLoading(false);
    }
  }

  function closeBarangay() {
    setSelectedBarangay(null);
    setSelectedFamily(null);
    setCenters(null);
    setActiveTab("residents");
    setExpandedRooms({});
  }

  // NEW: members are fetched when the modal opens
  async function openFamilyMembers(family) {
    setSelectedFamily({ ...family, members: null });

    try {
      setMembersLoading(true);

      const data = await api.getFamily(family.id);

      setSelectedFamily((previous) =>
        previous && previous.id === family.id ? data : previous
      );
    } catch (err) {
      console.error("Failed to load family:", err);
      setError(err.message || "Failed to load family members.");
      setSelectedFamily(null);
    } finally {
      setMembersLoading(false);
    }
  }

  function closeFamilyMembers() {
    setSelectedFamily(null);
  }

  function openImportModal() {
    setSelectedFile(null);
    setImportMessage("");
    setError("");
    setShowImport(true);
  }

  function closeImportModal() {
    if (importing) return;

    setShowImport(false);
    setSelectedFile(null);
    setImportMessage("");

    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  }

  function handleFileChange(event) {
    const file = event.target.files?.[0];

    if (!file) {
      setSelectedFile(null);
      return;
    }

    const allowedExtensions = [".xlsx", ".xls"];
    const fileName = file.name.toLowerCase();

    const validFile = allowedExtensions.some((extension) =>
      fileName.endsWith(extension)
    );

    if (!validFile) {
      setSelectedFile(null);
      setError("Please select an Excel file (.xlsx or .xls).");

      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }

      return;
    }

    setError("");
    setImportMessage("");
    setSelectedFile(file);
  }

  async function handleImport() {
    // Guard against duplicate submissions (double-click / Enter repeat)
    if (importing) return;

    if (!selectedFile) {
      setImportMessage("Please select an Excel file first.");
      return;
    }

    try {
      setImporting(true);
      setError("");
      setImportMessage("");

      const formData = new FormData();
      formData.append("file", selectedFile);

      const result = await api.uploadResidents(formData);

      setImportMessage(
        result?.message || "Excel data imported successfully."
      );

      setSelectedFile(null);

      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }

      await loadBarangays();

      setSelectedBarangay(null);
      setSelectedFamily(null);
      setCenters(null);
      setActiveTab("residents");
      setExpandedRooms({});
    } catch (err) {
      console.error("Excel import failed:", err);

      setImportMessage("");
      setError(err.message || "Failed to import Excel file.");
    } finally {
      setImporting(false);
    }
  }

  function exportBarangaysCSV() {
    const list = filteredBarangays;
    if (list.length === 0) return;
    const headers = ["ID", "Barangay Name", "Population", "Families", "Residents", "Evacuation Centers"];
    const rows = list.map((b) => [
      b.id,
      `"${(b.name || "").replace(/"/g, '""')}"`,
      b.population ?? 0,
      b.family_count ?? 0,
      b.resident_count ?? 0,
      b.evacuation_center_count ?? 0,
    ]);
    const csvContent = "data:text/csv;charset=utf-8," + [headers.join(","), ...rows.map((r) => r.join(","))].join("\n");
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    link.setAttribute("download", `evacway-barangays-${Date.now()}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  }

  function exportResidentFamiliesCSV() {
    if (!selectedBarangay) return;
    const list = filteredFamilies;
    if (list.length === 0) return;
    const headers = ["Family Code", "Household Head", "Members", "Contact Number", "Evacuation Status"];
    const rows = list.map((f) => [
      `"${(f.family_code || "").replace(/"/g, '""')}"`,
      `"${(f.head_name || "").replace(/"/g, '""')}"`,
      f.member_count ?? 0,
      `"${(f.contact_number || "").replace(/"/g, '""')}"`,
      `"${(f.evacuation_status || "Not assigned").replace(/"/g, '""')}"`,
    ]);
    const csvContent = "data:text/csv;charset=utf-8," + [headers.join(","), ...rows.map((r) => r.join(","))].join("\n");
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    link.setAttribute("download", `evacway-${(selectedBarangay.name || "barangay").toLowerCase().replace(/\\s+/g, "-")}-residents-${Date.now()}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  }

  function getMemberName(member) {
    if (!member) return "Unknown Resident";

    if (member.full_name) {
      return member.full_name;
    }

    const nameParts = [
      member.first_name,
      member.middle_name,
      member.last_name,
    ].filter(Boolean);

    if (nameParts.length > 0) {
      return nameParts.join(" ");
    }

    return member.household_head_name || "Unknown Resident";
  }

  function getMemberValue(member, fields) {
    for (const field of fields) {
      if (
        member?.[field] !== undefined &&
        member?.[field] !== null &&
        String(member[field]).trim() !== ""
      ) {
        return member[field];
      }
    }

    return "—";
  }

  function getRoomAssignedCount(room) {
    if (
      room?.assigned_count !== undefined &&
      room?.assigned_count !== null
    ) {
      return Number(room.assigned_count);
    }

    if (Array.isArray(room?.assigned_residents)) {
      return room.assigned_residents.length;
    }

    if (Array.isArray(room?.families)) {
      return room.families.reduce(
        (total, family) =>
          total + Number(family.assigned_members || 0),
        0
      );
    }

    return 0;
  }

  function getRoomAvailableCount(room) {
    const capacity = Number(room?.capacity || 0);
    const assigned = getRoomAssignedCount(room);

    return Math.max(capacity - assigned, 0);
  }

  function toggleRoom(roomId) {
    setExpandedRooms((previous) => ({
      ...previous,
      [roomId]: !previous[roomId],
    }));
  }

  function getFamilyAssignedMembers(family) {
    if (
      family?.assigned_members !== undefined &&
      family?.assigned_members !== null
    ) {
      return Number(family.assigned_members);
    }

    if (Array.isArray(family?.members)) {
      return family.members.length;
    }

    if (family?.member_count !== undefined) {
      return Number(family.member_count || 0);
    }

    return 0;
  }

  // Filtered and paginated barangays
  const filteredBarangays = barangays.filter((b) => {
    if (!barangaySearch.trim()) return true;
    const q = barangaySearch.toLowerCase();
    return (
      (b.name && b.name.toLowerCase().includes(q)) ||
      (b.population && String(b.population).includes(q))
    );
  });
  const brgyPerPage = 12;
  const brgyTotalPages = Math.max(1, Math.ceil(filteredBarangays.length / brgyPerPage));
  const paginatedBarangays = filteredBarangays.slice((brgyPage - 1) * brgyPerPage, brgyPage * brgyPerPage);

  // Filtered and paginated residents inside selectedBarangay
  const filteredFamilies = (selectedBarangay?.families || []).filter((fam) => {
    if (!residentSearch.trim()) return true;
    const q = residentSearch.toLowerCase();
    return (
      (fam.family_code && fam.family_code.toLowerCase().includes(q)) ||
      (fam.head_name && fam.head_name.toLowerCase().includes(q)) ||
      (fam.contact_number && fam.contact_number.toLowerCase().includes(q)) ||
      (fam.evacuation_status && fam.evacuation_status.toLowerCase().includes(q))
    );
  });
  const residentPerPage = 15;
  const residentTotalPages = Math.max(1, Math.ceil(filteredFamilies.length / residentPerPage));
  const paginatedFamilies = filteredFamilies.slice((residentPage - 1) * residentPerPage, residentPage * residentPerPage);

  if (loading) {
    return (
      <div className="barangay-page">
        <LoadingState message="Loading barangay records..." />
      </div>
    );
  }

  return (
    <div className="barangay-page">

      {/* PAGE HEADER */}

      <div className="barangay-header">

        <div>
          <p className="barangay-kicker">LGU Records</p>
          <h2 className="barangay-title">
            {workspaceTab === "families" ? "Families" : "Barangays"}
          </h2>

          <p className="barangay-subtitle">
            {workspaceTab === "families"
              ? "Registered households and their evacuation assignments."
              : "Manage barangays, residents, and evacuation centers."}
          </p>
        </div>

        <div className="barangay-header-actions">

          {workspaceTab === "barangays" && !selectedBarangay && (
            <>
              <button
                type="button"
                className="btn btn-primary"
                onClick={openImportModal}
                disabled={importing}
              >
                <FontAwesomeIcon
                  icon={importing ? faRotate : faFileExcel}
                  spin={importing}
                />
                {importing ? "Importing..." : "Import Excel"}
              </button>

              <button
                type="button"
                className="btn btn-secondary"
                onClick={exportBarangaysCSV}
                title="Export Barangays to CSV"
              >
                <FontAwesomeIcon icon={faDownload} />
                Export CSV
              </button>
            </>
          )}

          <button
            type="button"
            className="btn btn-secondary"
            onClick={loadBarangays}
            disabled={loading}
          >
            <FontAwesomeIcon icon={faRotate} spin={loading} />
            Refresh
          </button>

        </div>

      </div>

      <div className="barangay-workspace-tabs" role="tablist" aria-label="Barangay workspace">
        <button
          type="button"
          role="tab"
          aria-selected={workspaceTab === "barangays"}
          className={workspaceTab === "barangays" ? "active" : ""}
          onClick={() => setWorkspaceTab("barangays")}
        >
          <FontAwesomeIcon icon={faLocationDot} /> Barangays
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={workspaceTab === "families"}
          className={workspaceTab === "families" ? "active" : ""}
          onClick={() => setWorkspaceTab("families")}
        >
          <FontAwesomeIcon icon={faUsers} /> Families
        </button>
      </div>

      {/* ERROR */}

      {error && !showImport && (
        <div className="alert alert-error">

          <span className="alert-icon">
            <FontAwesomeIcon icon={faTriangleExclamation} />
          </span>

          <span>
            {error}
          </span>

        </div>
      )}

      {/* =====================================================
          BARANGAY DETAIL
      ===================================================== */}

      {workspaceTab === "families" ? (
        <FamilyManagement barangays={barangays} />
      ) : selectedBarangay ? (

        <div className="barangay-detail">

          <button
            className="back-button"
            onClick={closeBarangay}
          >
            <FontAwesomeIcon icon={faArrowLeft} />
            Back to Barangays
          </button>

          {/* BARANGAY HEADER */}

          <div className="detail-header-card">

            <div className="detail-heading">

              <div className="barangay-icon large">
                <FontAwesomeIcon icon={faLocationDot} />
              </div>

              <div>
                <h3>
                  {selectedBarangay.name}
                </h3>

                <p>
                  Barangay information and evacuation records
                </p>
              </div>

            </div>

            <div className="detail-stats">

              <div className="stat-box">
                <span className="stat-label">
                  Population
                </span>

                <strong>
                  {selectedBarangay.population ?? "—"}
                </strong>
              </div>

              <div className="stat-box">
                <span className="stat-label">
                  Families
                </span>

                <strong>
                  {selectedBarangay.family_count ??
                    selectedBarangay.families?.length ??
                    0}
                </strong>
              </div>

              <div className="stat-box">
                <span className="stat-label">
                  Residents
                </span>

                <strong>
                  {selectedBarangay.resident_count ?? 0}
                </strong>
              </div>

              <div className="stat-box">
                <span className="stat-label">
                  Evacuation Centers
                </span>

                <strong>
                  {selectedBarangay.evacuation_center_count ?? 0}
                </strong>
              </div>

            </div>

          </div>

          {/* =================================================
              MAIN TABS
          ================================================= */}

          <div className="barangay-tabs">

            <button
              type="button"
              className={`barangay-tab ${
                activeTab === "residents"
                  ? "active"
                  : ""
              }`}
              onClick={() => setActiveTab("residents")}
            >
              <FontAwesomeIcon icon={faUsers} />
              All Residents
            </button>

            <button
              type="button"
              className={`barangay-tab ${
                activeTab === "centers"
                  ? "active"
                  : ""
              }`}
              onClick={() => setActiveTab("centers")}
            >
              <FontAwesomeIcon icon={faBuilding} />
              Evacuation Centers
            </button>

          </div>

          {/* =================================================
              ALL RESIDENTS TAB
          ================================================= */}

          {activeTab === "residents" && (

            <div className="barangay-tab-content">

              <div className="section-header">

                <div>
                  <h3>
                    All Residents
                  </h3>

                  <p>
                    Residents and families registered under {selectedBarangay.name}.
                  </p>
                </div>

                {(selectedBarangay.families?.length || 0) > 0 && (
                  <button
                    type="button"
                    className="btn btn-sm btn-secondary"
                    onClick={exportResidentFamiliesCSV}
                    title="Export resident records to CSV"
                  >
                    <FontAwesomeIcon icon={faDownload} />
                    Export CSV
                  </button>
                )}

              </div>

              {(selectedBarangay.families?.length || 0) > 0 && (
                <div className="barangay-filter-bar">
                  <div className="barangay-search">
                    <FontAwesomeIcon icon={faMagnifyingGlass} />
                    <input
                      type="text"
                      placeholder="Search household head, code, contact, or status..."
                      value={residentSearch}
                      onChange={(e) => {
                        setResidentSearch(e.target.value);
                        setResidentPage(1);
                      }}
                      aria-label="Search residents"
                    />
                    {residentSearch && (
                      <button
                        type="button"
                        className="barangay-search-clear"
                        onClick={() => {
                          setResidentSearch("");
                          setResidentPage(1);
                        }}
                        aria-label="Clear search"
                      >
                        <FontAwesomeIcon icon={faXmark} />
                      </button>
                    )}
                  </div>
                </div>
              )}

              {filteredFamilies.length > 0 ? (

                <>
                  <div className="table-card">

                    <div className="table-scroll">

                      <table className="barangay-table">

                        <thead>
                          <tr>
                            <th>Family Code</th>
                            <th>Household Head</th>
                            <th>Members</th>
                            <th>Contact</th>
                            <th>Evacuation Status</th>
                            <th>Actions</th>
                          </tr>
                        </thead>

                        <tbody>

                          {paginatedFamilies.map((family) => (

                            <tr key={family.id}>

                              <td>
                                <span className="family-code">
                                  {family.family_code || "—"}
                                </span>
                              </td>

                              <td>

                                <div className="head-cell">

                                  <div className="small-avatar" style={{ background: "#edf4fc", color: "var(--brand, #1b5fc1)" }}>
                                    <FontAwesomeIcon
                                      icon={faUsers}
                                    />
                                  </div>

                                  <span>
                                    {family.head_name || "—"}
                                  </span>

                                </div>

                              </td>

                              <td>

                                <button
                                  type="button"
                                  className="member-count-button"
                                  onClick={() =>
                                    openFamilyMembers(family)
                                  }
                                  title="View family members"
                                >

                                  <FontAwesomeIcon
                                    icon={faUsers}
                                  />

                                  <span>
                                    {family.member_count ?? 0}
                                  </span>

                                </button>

                              </td>

                              <td>
                                {family.contact_number || "—"}
                              </td>

                              <td>
                                {(() => {
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
                                    : (family.evacuation_status && !family.evacuation_status.toLowerCase().includes("not assigned") ? family.evacuation_status : "Not assigned");

                                  return (
                                    <span
                                      className={`status-badge ${
                                        isAssigned
                                          ? "status-assigned"
                                          : statusText.toLowerCase().includes("evacuated")
                                          ? "status-evacuated"
                                          : "status-pending"
                                      }`}
                                    >
                                      {statusText}
                                    </span>
                                  );
                                })()}
                              </td>

                              <td>
                                <button
                                  type="button"
                                  className="btn btn-sm btn-outline"
                                  onClick={() => openFamilyMembers(family)}
                                  title="View family members"
                                >
                                  View Members
                                </button>
                              </td>

                            </tr>

                          ))}

                        </tbody>

                      </table>

                    </div>

                  </div>

                  {filteredFamilies.length > residentPerPage && (
                    <div className="barangay-pagination">
                      <span>
                        {(residentPage - 1) * residentPerPage + 1}–{Math.min(residentPage * residentPerPage, filteredFamilies.length)} of {filteredFamilies.length} families
                      </span>
                      <div className="pagination-controls">
                        <button
                          type="button"
                          className="btn btn-sm btn-secondary"
                          disabled={residentPage <= 1}
                          onClick={() => setResidentPage((p) => p - 1)}
                        >
                          Previous
                        </button>
                        <span>Page {residentPage} of {residentTotalPages}</span>
                        <button
                          type="button"
                          className="btn btn-sm btn-secondary"
                          disabled={residentPage >= residentTotalPages}
                          onClick={() => setResidentPage((p) => p + 1)}
                        >
                          Next
                        </button>
                      </div>
                    </div>
                  )}
                </>

              ) : selectedBarangay.families?.length > 0 ? (

                <div className="empty-state">

                  <div className="empty-icon">
                    <FontAwesomeIcon icon={faUsers} />
                  </div>

                  <h3>
                    No residents found matching "{residentSearch}"
                  </h3>

                  <p>
                    Try searching for a different household head, code, or clear your search.
                  </p>

                  <button
                    type="button"
                    className="btn btn-secondary"
                    onClick={() => {
                      setResidentSearch("");
                      setResidentPage(1);
                    }}
                  >
                    Clear Search
                  </button>

                </div>

              ) : (

                <div className="empty-state">

                  <div className="empty-icon">
                    <FontAwesomeIcon icon={faUsers} />
                  </div>

                  <h3>
                    No residents found
                  </h3>

                  <p>
                    This barangay does not have any resident
                    records yet.
                  </p>

                </div>

              )}

            </div>

          )}

          {/* =================================================
              EVACUATION CENTERS TAB
          ================================================= */}

          {activeTab === "centers" && (

            <div className="barangay-tab-content">

              <div className="section-header">

                <div>
                  <h3>
                    Evacuation Centers
                  </h3>

                  <p>
                    Evacuation centers and rooms imported from
                    Excel.
                  </p>
                </div>

              </div>

              {centers === null || centersLoading ? (

                <LoadingState message="Loading evacuation centers..." />

              ) : centers.length > 0 ? (

                <div className="evacuation-center-list">

                  {centers.map(
                    (center) => (

                      <div
                        className="evacuation-center-card"
                        key={center.id}
                      >

                        {/* CENTER HEADER */}

                        <div className="evacuation-center-header">

                          <div className="center-title">

                            <div className="small-avatar">
                              <FontAwesomeIcon
                                icon={faBuilding}
                              />
                            </div>

                            <div>
                              <h3>
                                {center.name || "—"}
                              </h3>

                              <span>
                                Evacuation Center
                              </span>
                            </div>

                          </div>

                          <span
                            className={`status-badge ${
                              center.is_active
                                ? "status-assigned"
                                : "status-pending"
                            }`}
                          >
                            {center.is_active
                              ? "Active"
                              : "Inactive"}
                          </span>

                        </div>

                        {/* CENTER INFORMATION */}

                        <div className="center-info-grid">

                          <div className="center-info-item">

                            <span>
                              Capacity
                            </span>

                            <strong>
                              {center.capacity ?? "—"}
                            </strong>

                          </div>

                          <div className="center-info-item">

                            <span>
                              Building Material
                            </span>

                            <strong>
                              {center.building_material || "—"}
                            </strong>

                          </div>

                          <div className="center-info-item">

                            <span>
                              Contact
                            </span>

                            <strong>
                              {center.contact_number || "—"}
                            </strong>

                          </div>

                          <div className="center-info-item">

                            <span>
                              Map Status
                            </span>

                            <strong>
                              {center.has_map
                                ? "Mapped"
                                : "Not mapped"}
                            </strong>

                          </div>

                        </div>

                        {/* ACCESSIBILITY */}

                        {center.accessibility_notes && (

                          <div className="center-notes">

                            <span>
                              Accessibility Notes
                            </span>

                            <p>
                              {center.accessibility_notes}
                            </p>

                          </div>

                        )}

                        {/* ROOMS */}

                        <div className="center-rooms">

                          <div className="center-rooms-header">

                            <div>

                              <h4>
                                Rooms
                              </h4>

                              <span>
                                {center.rooms?.length || 0}{" "}
                                room
                                {center.rooms?.length === 1
                                  ? ""
                                  : "s"}
                              </span>

                            </div>

                          </div>

                          {center.rooms?.length > 0 ? (

                            <div className="room-list">

                              {center.rooms.map((room) => {

                                const assigned =
                                  getRoomAssignedCount(room);

                                const capacity =
                                  Number(
                                    room.capacity || 0
                                  );

                                const available =
                                  getRoomAvailableCount(room);

                                const hasLocation =
                                  room.latitude !== null &&
                                  room.latitude !== undefined &&
                                  room.longitude !== null &&
                                  room.longitude !== undefined;

                                const isExpanded =
                                  !!expandedRooms[room.id];

                                return (

                                  <div
                                    className={`room-item ${
                                      isExpanded
                                        ? "room-item-expanded"
                                        : ""
                                    }`}
                                    key={room.id}
                                  >

                                    {/* ROOM HEADER / DROPDOWN BUTTON */}

                                    <button
                                      type="button"
                                      className="room-dropdown-button"
                                      onClick={() =>
                                        toggleRoom(room.id)
                                      }
                                    >

                                      <div className="room-icon">
                                        <FontAwesomeIcon
                                          icon={faDoorOpen}
                                        />
                                      </div>

                                      <div className="room-main">

                                        <strong>
                                          {room.room_number ||
                                            "—"}
                                        </strong>

                                        <span>
                                          {assigned} assigned /{" "}
                                          {capacity} capacity
                                        </span>

                                      </div>

                                      <div className="room-stat">

                                        <span>
                                          Capacity
                                        </span>

                                        <strong>
                                          {capacity}
                                        </strong>

                                      </div>

                                      <div className="room-stat">

                                        <span>
                                          Assigned
                                        </span>

                                        <strong>
                                          {assigned}
                                        </strong>

                                      </div>

                                      <div className="room-stat">

                                        <span>
                                          Available
                                        </span>

                                        <strong>
                                          {available}
                                        </strong>

                                      </div>

                                      <div className="room-location">

                                        {hasLocation ? (

                                          <span className="status-badge status-assigned">
                                            <FontAwesomeIcon
                                              icon={faLocationDot}
                                            />
                                            Mapped
                                          </span>

                                        ) : (

                                          <span className="status-badge status-pending">
                                            Not mapped
                                          </span>

                                        )}

                                      </div>

                                      <span className="room-dropdown-arrow">
                                        <FontAwesomeIcon
                                          icon={
                                            isExpanded
                                              ? faChevronUp
                                              : faChevronDown
                                          }
                                        />
                                      </span>

                                    </button>

                                    {/* ROOM DROPDOWN */}

                                    {isExpanded && (

                                      <div className="room-dropdown-content">

                                        <div className="room-assigned-header">

                                          <div>
                                            <strong>
                                              Assigned Families
                                            </strong>

                                            <span>
                                              Families currently assigned
                                              to this room
                                            </span>
                                          </div>

                                          <span className="room-family-count">
                                            {room.families?.length || 0}
                                          </span>

                                        </div>

                                        {room.families?.length > 0 ? (

                                          <div className="room-family-list">

                                            {room.families.map(
                                              (family) => {

                                                const familyAssigned =
                                                  getFamilyAssignedMembers(
                                                    family
                                                  );

                                                const familyStatus =
                                                  family.evacuation_status ||
                                                  "Not Evacuated";

                                                const isEvacuated =
                                                  familyStatus
                                                    .toLowerCase()
                                                    .includes(
                                                      "evacuated"
                                                    );

                                                return (

                                                  <div
                                                    className="room-family"
                                                    key={family.id}
                                                  >

                                                    <div className="room-family-left">

                                                      <div className="room-family-icon">
                                                        <FontAwesomeIcon
                                                          icon={faUsers}
                                                        />
                                                      </div>

                                                      <div className="room-family-info">

                                                        <strong>
                                                          {family.family_code ||
                                                            "Family"}
                                                        </strong>

                                                        <span>
                                                          {family.head_name ||
                                                            "No household head"}
                                                        </span>

                                                        <small>
                                                          {familyAssigned}{" "}
                                                          member
                                                          {familyAssigned !==
                                                          1
                                                            ? "s"
                                                            : ""}{" "}
                                                          assigned to this
                                                          room
                                                        </small>

                                                      </div>

                                                    </div>

                                                    <div className="room-family-right">

                                                      <span
                                                        className={`status-badge ${
                                                          isEvacuated
                                                            ? "status-evacuated"
                                                            : "status-pending"
                                                        }`}
                                                      >
                                                        {familyStatus}
                                                      </span>

                                                    </div>

                                                  </div>

                                                );
                                              }
                                            )}

                                          </div>

                                        ) : (

                                          <div className="room-no-families">

                                            <FontAwesomeIcon
                                              icon={faUsers}
                                            />

                                            <span>
                                              No families assigned to
                                              this room.
                                            </span>

                                          </div>

                                        )}

                                      </div>

                                    )}

                                  </div>

                                );

                              })}

                            </div>

                          ) : (

                            <div className="room-empty">

                              <FontAwesomeIcon
                                icon={faDoorOpen}
                              />

                              <span>
                                No rooms found for this
                                evacuation center.
                              </span>

                            </div>

                          )}

                        </div>

                      </div>

                    )
                  )}

                </div>

              ) : (

                <div className="empty-state">

                  <div className="empty-icon">
                    <FontAwesomeIcon icon={faBuilding} />
                  </div>

                  <h3>
                    No evacuation centers found
                  </h3>

                  <p>
                    No evacuation centers were imported for
                    this barangay yet.
                  </p>

                </div>

              )}

            </div>

          )}

        </div>

      ) : (

        <>

          {/* =================================================
              BARANGAY LIST
          ================================================= */}

          {barangays.length === 0 ? (

            <div className="empty-state">

              <div className="empty-icon">
                <FontAwesomeIcon icon={faLocationDot} />
              </div>

              <h3>
                No barangays found
              </h3>

              <p>
                Import the new Excel file to add barangays,
                families, residents, evacuation centers, and
                rooms.
              </p>

              <button
                className="btn btn-primary"
                onClick={openImportModal}
              >
                <FontAwesomeIcon icon={faUpload} />
                Import Excel
              </button>

            </div>

          ) : (

            <>
              {/* Search & Filter / View Toggle Bar */}
              <div className="barangay-filter-bar">
                <div className="barangay-search">
                  <FontAwesomeIcon icon={faMagnifyingGlass} />
                  <input
                    type="text"
                    placeholder="Search barangays by name..."
                    value={barangaySearch}
                    onChange={(e) => {
                      setBarangaySearch(e.target.value);
                      setBrgyPage(1);
                    }}
                    aria-label="Search barangays"
                  />
                  {barangaySearch && (
                    <button
                      type="button"
                      className="barangay-search-clear"
                      onClick={() => {
                        setBarangaySearch("");
                        setBrgyPage(1);
                      }}
                      aria-label="Clear search"
                    >
                      <FontAwesomeIcon icon={faXmark} />
                    </button>
                  )}
                </div>

                <div className="barangay-filter-actions">
                  <div className="barangay-view-toggle">
                    <button
                      type="button"
                      className={viewMode === "table" ? "active" : ""}
                      onClick={() => setViewMode("table")}
                      title="Table view"
                    >
                      <FontAwesomeIcon icon={faTableList} />
                      Table
                    </button>
                    <button
                      type="button"
                      className={viewMode === "grid" ? "active" : ""}
                      onClick={() => setViewMode("grid")}
                      title="Cards view"
                    >
                      <FontAwesomeIcon icon={faGrip} />
                      Cards
                    </button>
                  </div>
                </div>
              </div>

              {filteredBarangays.length > 0 ? (
                <>
                  {viewMode === "table" ? (
                    <div className="table-card">
                      <div className="table-scroll">
                        <table className="barangay-table">
                          <thead>
                            <tr>
                              <th>Barangay Name</th>
                              <th>Population</th>
                              <th>Registered Families</th>
                              <th>Registered Residents</th>
                              <th>Evacuation Centers</th>
                              <th>Status</th>
                              <th>Actions</th>
                            </tr>
                          </thead>
                          <tbody>
                            {paginatedBarangays.map((barangay) => (
                              <tr key={barangay.id}>
                                <td>
                                  <div className="head-cell">
                                    <div className="small-avatar" style={{ background: "#edf4fc", color: "var(--brand, #1b5fc1)" }}>
                                      <FontAwesomeIcon icon={faLocationDot} />
                                    </div>
                                    <strong style={{ fontSize: "13.5px", color: "var(--ink, #0e1f3a)" }}>{barangay.name}</strong>
                                  </div>
                                </td>
                                <td><strong>{barangay.population ?? "—"}</strong></td>
                                <td>{barangay.family_count ?? 0}</td>
                                <td>{barangay.resident_count ?? 0}</td>
                                <td>
                                  <span className={`status-badge ${(barangay.evacuation_center_count || 0) > 0 ? "status-assigned" : "status-pending"}`}>
                                    <FontAwesomeIcon icon={faBuilding} /> {barangay.evacuation_center_count ?? 0} center(s)
                                  </span>
                                </td>
                                <td>
                                  <span className="status-badge status-assigned">
                                    <FontAwesomeIcon icon={faCircleCheck} /> Active
                                  </span>
                                </td>
                                <td>
                                  <button
                                    type="button"
                                    className="btn btn-sm btn-secondary"
                                    onClick={() => openBarangay(barangay.id)}
                                    disabled={detailLoading}
                                    title="View Barangay details"
                                  >
                                    <span>{detailLoading ? "Loading..." : "View Barangay"}</span>
                                    <FontAwesomeIcon
                                      icon={detailLoading ? faRotate : faArrowRight}
                                      spin={detailLoading}
                                    />
                                  </button>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  ) : (
                    <div className="barangay-grid">
                      {paginatedBarangays.map((barangay) => (
                        <div className="barangay-card" key={barangay.id}>
                          <div className="card-top">
                            <div className="barangay-icon">
                              <FontAwesomeIcon icon={faLocationDot} />
                            </div>
                            <div className="card-title-area">
                              <h3>{barangay.name}</h3>
                              <span>Barangay</span>
                            </div>
                          </div>

                          <div className="card-stats">
                            <div className="card-stat">
                              <span>Population</span>
                              <strong>{barangay.population ?? "—"}</strong>
                            </div>
                            <div className="card-stat">
                              <span>Families</span>
                              <strong>{barangay.family_count ?? 0}</strong>
                            </div>
                            <div className="card-stat">
                              <span>Residents</span>
                              <strong>{barangay.resident_count ?? 0}</strong>
                            </div>
                            <div className="card-stat">
                              <span>Centers</span>
                              <strong>{barangay.evacuation_center_count ?? 0}</strong>
                            </div>
                          </div>

                          <button
                            className="view-button"
                            onClick={() => openBarangay(barangay.id)}
                            disabled={detailLoading}
                          >
                            <span>{detailLoading ? "Loading..." : "View Barangay"}</span>
                            <FontAwesomeIcon
                              icon={detailLoading ? faRotate : faArrowRight}
                              spin={detailLoading}
                            />
                          </button>
                        </div>
                      ))}
                    </div>
                  )}

                  {filteredBarangays.length > brgyPerPage && (
                    <div className="barangay-pagination">
                      <span>
                        {(brgyPage - 1) * brgyPerPage + 1}–{Math.min(brgyPage * brgyPerPage, filteredBarangays.length)} of {filteredBarangays.length} barangays
                      </span>
                      <div className="pagination-controls">
                        <button
                          type="button"
                          className="btn btn-sm btn-secondary"
                          disabled={brgyPage <= 1}
                          onClick={() => setBrgyPage((p) => p - 1)}
                        >
                          Previous
                        </button>
                        <span>Page {brgyPage} of {brgyTotalPages}</span>
                        <button
                          type="button"
                          className="btn btn-sm btn-secondary"
                          disabled={brgyPage >= brgyTotalPages}
                          onClick={() => setBrgyPage((p) => p + 1)}
                        >
                          Next
                        </button>
                      </div>
                    </div>
                  )}
                </>
              ) : (
                <div className="empty-state">
                  <div className="empty-icon">
                    <FontAwesomeIcon icon={faLocationDot} />
                  </div>
                  <h3>No barangays matching "{barangaySearch}"</h3>
                  <p>Try searching for a different name or clear your search.</p>
                  <button
                    type="button"
                    className="btn btn-secondary"
                    onClick={() => {
                      setBarangaySearch("");
                      setBrgyPage(1);
                    }}
                  >
                    Clear Search
                  </button>
                </div>
              )}
            </>

          )}

        </>

      )}

      {/* =====================================================
          FAMILY MEMBERS MODAL
      ===================================================== */}

      {selectedFamily && (

        <div
          className="modal-overlay family-modal-overlay"
          onMouseDown={(event) => {

            if (
              event.target === event.currentTarget
            ) {
              closeFamilyMembers();
            }

          }}
        >

          <div className="family-modal">

            <div className="modal-header">

              <div className="modal-heading">

                <div className="modal-icon">
                  <FontAwesomeIcon
                    icon={faPeopleGroup}
                  />
                </div>

                <div>

                  <h3>
                    Family Members
                  </h3>

                  <p>
                    {selectedFamily.family_code ||
                      "Family"}{" "}
                    ·{" "}
                    {selectedFamily.member_count ?? 0} members
                  </p>

                </div>

              </div>

              <button
                className="modal-close"
                onClick={closeFamilyMembers}
                aria-label="Close"
              >
                <FontAwesomeIcon icon={faXmark} />
              </button>

            </div>

            <div className="family-summary">

              <div className="family-summary-item">
                <div className="family-summary-icon">
                  <FontAwesomeIcon icon={faUser} />
                </div>
                <div>
                  <span>Household Head</span>
                  <strong>{selectedFamily.head_name || "—"}</strong>
                </div>
              </div>

              <div className="family-summary-item">
                <div className="family-summary-icon">
                  <FontAwesomeIcon icon={faPhone} />
                </div>
                <div>
                  <span>Contact</span>
                  <strong>{selectedFamily.contact_number || "—"}</strong>
                </div>
              </div>

              <div className="family-summary-item">
                <div className="family-summary-icon">
                  <FontAwesomeIcon icon={faBuilding} />
                </div>
                <div>
                  <span>Evacuation Center</span>
                  <strong>
                    {selectedFamily.current_center ||
                      selectedFamily.evacuation_center ||
                      selectedFamily.assignments?.[0]?.center ||
                      "Not assigned"}
                  </strong>
                </div>
              </div>

              <div className="family-summary-item">
                <div className="family-summary-icon">
                  <FontAwesomeIcon icon={faDoorOpen} />
                </div>
                <div>
                  <span>Assigned Room</span>
                  <strong>
                    {(() => {
                      const r =
                        selectedFamily.current_room ||
                        selectedFamily.rooms ||
                        selectedFamily.assignments?.[0]?.room;
                      if (!r) return "Not assigned";
                      return String(r).toLowerCase().startsWith("room") ? r : `Room ${r}`;
                    })()}
                  </strong>
                </div>
              </div>

              <div className="family-summary-item">
                <div className="family-summary-icon">
                  <FontAwesomeIcon icon={faShieldHeart} />
                </div>
                <div>
                  <span>Status</span>
                  <strong>
                    {selectedFamily.current_room_id ||
                    (selectedFamily.assigned_members && selectedFamily.assigned_members > 0) ||
                    (Array.isArray(selectedFamily.assignments) && selectedFamily.assignments.length > 0) ||
                    selectedFamily.current_room ||
                    selectedFamily.current_center ||
                    (selectedFamily.evacuation_status && selectedFamily.evacuation_status.toLowerCase().includes("assigned"))
                      ? "Assigned"
                      : (selectedFamily.evacuation_status && !selectedFamily.evacuation_status.toLowerCase().includes("not assigned")
                      ? selectedFamily.evacuation_status
                      : "Not assigned")}
                  </strong>
                </div>
              </div>

            </div>

            <div className="family-modal-body">

              {membersLoading || selectedFamily.members === null ? (

                <div className="barangay-loading">
                  <div className="loading-spinner"></div>
                  <p>Loading family members...</p>
                </div>

              ) : selectedFamily.members?.length > 0 ? (

                <div className="member-list">

                  {selectedFamily.members.map(
                    (member, index) => {

                      const vulnerableMembers =
                        getMemberValue(
                          member,
                          ["vulnerable_members"]
                        );

                      const remarks =
                        getMemberValue(
                          member,
                          ["remarks"]
                        );

                      return (

                        <div
                          className="member-card"
                          key={member.id ?? index}
                        >

                          <div className="member-card-header">

                            <div className="member-avatar">
                              <FontAwesomeIcon
                                icon={faUser}
                              />
                            </div>

                            <div className="member-name-area">

                              <h4>
                                {getMemberName(member)}
                              </h4>

                              <span>
                                Family Member {index + 1}
                              </span>

                            </div>

                          </div>

                          <div className="member-details">

                            <div className="member-detail">
                              <FontAwesomeIcon
                                icon={faUser}
                              />

                              <div>
                                <span>First Name</span>
                                <strong>
                                  {getMemberValue(
                                    member,
                                    ["first_name"]
                                  )}
                                </strong>
                              </div>
                            </div>

                            <div className="member-detail">
                              <FontAwesomeIcon
                                icon={faUser}
                              />

                              <div>
                                <span>Middle Name</span>
                                <strong>
                                  {getMemberValue(
                                    member,
                                    ["middle_name"]
                                  )}
                                </strong>
                              </div>
                            </div>

                            <div className="member-detail">
                              <FontAwesomeIcon
                                icon={faUser}
                              />

                              <div>
                                <span>Last Name</span>
                                <strong>
                                  {getMemberValue(
                                    member,
                                    ["last_name"]
                                  )}
                                </strong>
                              </div>
                            </div>

                            <div className="member-detail">
                              <FontAwesomeIcon
                                icon={faHouse}
                              />

                              <div>
                                <span>Household Head</span>
                                <strong>
                                  {getMemberValue(
                                    member,
                                    ["household_head_name"]
                                  )}
                                </strong>
                              </div>
                            </div>

                            <div className="member-detail">
                              <FontAwesomeIcon
                                icon={faMapLocationDot}
                              />

                              <div>
                                <span>Barangay</span>
                                <strong>
                                  {getMemberValue(
                                    member,
                                    ["barangay"]
                                  )}
                                </strong>
                              </div>
                            </div>

                            <div className="member-detail member-detail-wide">
                              <FontAwesomeIcon
                                icon={faLocationDot}
                              />

                              <div>
                                <span>Address</span>
                                <strong>
                                  {getMemberValue(
                                    member,
                                    [
                                      "address",
                                      "address_purok",
                                    ]
                                  )}
                                </strong>
                              </div>
                            </div>

                            <div className="member-detail">
                              <FontAwesomeIcon
                                icon={faPhone}
                              />

                              <div>
                                <span>Contact</span>
                                <strong>
                                  {getMemberValue(
                                    member,
                                    [
                                      "contact_number",
                                      "contact",
                                    ]
                                  )}
                                </strong>
                              </div>
                            </div>

                            <div className="member-detail">
                              <FontAwesomeIcon
                                icon={faUsers}
                              />

                              <div>
                                <span>Family Members</span>
                                <strong>
                                  {getMemberValue(
                                    member,
                                    ["family_members"]
                                  )}
                                </strong>
                              </div>
                            </div>

                            <div className="member-detail">
                              <FontAwesomeIcon
                                icon={faShieldHeart}
                              />

                              <div>
                                <span>
                                  Vulnerable Members
                                </span>

                                <strong>
                                  {vulnerableMembers}
                                </strong>
                              </div>
                            </div>

                            <div className="member-detail member-detail-wide">
                              <FontAwesomeIcon
                                icon={faPeopleGroup}
                              />

                              <div>
                                <span>Remarks</span>
                                <strong>
                                  {remarks}
                                </strong>
                              </div>
                            </div>

                          </div>

                        </div>

                      );
                    }
                  )}

                </div>

              ) : (

                <div className="member-empty">

                  <div className="member-empty-icon">
                    <FontAwesomeIcon icon={faUsers} />
                  </div>

                  <h4>
                    No members found
                  </h4>

                  <p>
                    This family does not have individual
                    resident records yet.
                  </p>

                </div>

              )}

            </div>

            <div className="modal-footer">

              <button
                className="btn btn-secondary"
                onClick={closeFamilyMembers}
              >
                Close
              </button>

            </div>

          </div>

        </div>

      )}

      {/* =====================================================
          IMPORT MODAL
      ===================================================== */}

      {showImport && (

        <div className="modal-overlay">

          <div className="import-modal">

            <div className="modal-header">

              <div className="modal-heading">

                <div className="modal-icon">
                  <FontAwesomeIcon
                    icon={faFileExcel}
                  />
                </div>

                <div>

                  <h3>
                    Import Excel Data
                  </h3>

                  <p>
                    Import residents, families, evacuation
                    centers, rooms, and assignments.
                  </p>

                </div>

              </div>

              <button
                className="modal-close"
                onClick={closeImportModal}
                disabled={importing}
                aria-label="Close"
              >
                <FontAwesomeIcon icon={faXmark} />
              </button>

            </div>

            <div className="modal-body">

              <div className="import-info">

                <strong>
                  Excel is the source of the new data
                </strong>

                <p>
                  The selected Excel file will be used to
                  create the barangay, family, resident,
                  evacuation center, room, and assignment
                  records.
                </p>

                <p>
                  Evacuation center polygons, entrances, and
                  room map locations are not imported from
                  Excel. These will be added later using
                  the map.
                </p>

              </div>

              <label className="file-label">
                Excel File
              </label>

              <div className="file-upload">

                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".xlsx,.xls"
                  onChange={handleFileChange}
                  disabled={importing}
                />

                <div className="file-upload-content">

                  <div className="upload-icon">
                    <FontAwesomeIcon icon={faUpload} />
                  </div>

                  <strong>
                    {selectedFile
                      ? selectedFile.name
                      : "Choose an Excel file"}
                  </strong>

                  <span>
                    {selectedFile
                      ? `${(
                          selectedFile.size / 1024
                        ).toFixed(1)} KB`
                      : ".xlsx or .xls files"}
                  </span>

                </div>

              </div>

              <div className="requirements">

                <div className="requirements-title">
                  Excel columns
                </div>

                <div className="column-list">

                  <span>First Name</span>
                  <span>Middle Name</span>
                  <span>Last Name</span>
                  <span>Household Head Name</span>
                  <span>Barangay</span>
                  <span>Address</span>
                  <span>Contact</span>
                  <span>Family Members</span>
                  <span>Vulnerable Members</span>
                  <span>Remarks</span>
                  <span>Evacuation Center</span>
                  <span>Center Capacity</span>
                  <span>Building Material</span>
                  <span>Accessibility Notes</span>
                  <span>Center Contact</span>
                  <span>Room Number</span>
                  <span>Room Capacity</span>

                </div>

              </div>

              {importMessage && (

                <div className="alert alert-success">

                  <span className="alert-icon">
                    <FontAwesomeIcon
                      icon={faCircleCheck}
                    />
                  </span>

                  <span>
                    {importMessage}
                  </span>

                </div>

              )}

              {error && (

                <div className="alert alert-error">

                  <span className="alert-icon">
                    <FontAwesomeIcon
                      icon={faTriangleExclamation}
                    />
                  </span>

                  <span>
                    {error}
                  </span>

                </div>

              )}

            </div>

            <div className="modal-footer">

              <button
                className="btn btn-secondary"
                onClick={closeImportModal}
                disabled={importing}
              >
                Cancel
              </button>

              <button
                className="btn btn-primary"
                onClick={handleImport}
                disabled={!selectedFile || importing}
              >

                <FontAwesomeIcon
                  icon={
                    importing
                      ? faRotate
                      : faUpload
                  }
                  spin={importing}
                />

                {importing
                  ? "Importing..."
                  : "Import Excel"}

              </button>

            </div>

          </div>

        </div>

      )}

    </div>
  );
}

export default BarangayManager;
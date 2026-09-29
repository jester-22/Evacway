import { useEffect, useRef, useState } from "react";
import { api } from "../services/api";
import "../components_css/BarangayManager.css";
import "../components_css/BarangayManager.motion.css";
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
} from "@fortawesome/free-solid-svg-icons";

function BarangayManager() {
  const [barangays, setBarangays] = useState([]);
  const [selectedBarangay, setSelectedBarangay] = useState(null);
  const [selectedFamily, setSelectedFamily] = useState(null);

  const [activeTab, setActiveTab] = useState("residents");

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

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

  if (loading) {
    return (
      <div className="barangay-page">
        <div className="barangay-loading">
          <div className="loading-spinner"></div>
          <p>Loading barangays...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="barangay-page">

      {/* PAGE HEADER */}

      <div className="barangay-header">

        <div>
          <h2 className="barangay-title">
            Barangays
          </h2>

          <p className="barangay-subtitle">
            Manage barangays, residents, and evacuation centers.
          </p>
        </div>

        <div className="barangay-header-actions">

          <button
            className="btn btn-primary"
            onClick={openImportModal}
          >
            <FontAwesomeIcon icon={faPlus} />
            Import Excel
          </button>

          <button
            className="btn btn-secondary"
            onClick={loadBarangays}
          >
            <FontAwesomeIcon icon={faRotate} />
            Refresh
          </button>

        </div>

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

      {selectedBarangay ? (

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
                    Residents and families registered under this
                    barangay.
                  </p>
                </div>

              </div>

              {selectedBarangay.families?.length > 0 ? (

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
                        </tr>
                      </thead>

                      <tbody>

                        {selectedBarangay.families.map(
                          (family) => (

                            <tr key={family.id}>

                              <td>
                                <span className="family-code">
                                  {family.family_code || "—"}
                                </span>
                              </td>

                              <td>

                                <div className="head-cell">

                                  <div className="small-avatar">
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

                                <span
                                  className={`status-badge ${
                                    family.evacuation_status
                                      ?.toLowerCase()
                                      .includes("assigned")
                                      ? "status-assigned"
                                      : family.evacuation_status
                                          ?.toLowerCase()
                                          .includes("evacuated")
                                      ? "status-evacuated"
                                      : "status-pending"
                                  }`}
                                >
                                  {family.evacuation_status ||
                                    "Not assigned"}
                                </span>

                              </td>

                            </tr>

                          )
                        )}

                      </tbody>

                    </table>

                  </div>

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

                <div className="barangay-loading">
                  <div className="loading-spinner"></div>
                  <p>Loading evacuation centers...</p>
                </div>

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

            <div className="barangay-grid">

              {barangays.map((barangay) => (

                <div
                  className="barangay-card"
                  key={barangay.id}
                >

                  <div className="card-top">

                    <div className="barangay-icon">
                      <FontAwesomeIcon
                        icon={faLocationDot}
                      />
                    </div>

                    <div className="card-title-area">

                      <h3>
                        {barangay.name}
                      </h3>

                      <span>
                        Barangay
                      </span>

                    </div>

                  </div>

                  <div className="card-stats">

                    <div className="card-stat">

                      <span>
                        Population
                      </span>

                      <strong>
                        {barangay.population ?? "—"}
                      </strong>

                    </div>

                    <div className="card-stat">

                      <span>
                        Families
                      </span>

                      <strong>
                        {barangay.family_count ?? 0}
                      </strong>

                    </div>

                    <div className="card-stat">

                      <span>
                        Residents
                      </span>

                      <strong>
                        {barangay.resident_count ?? 0}
                      </strong>

                    </div>

                    <div className="card-stat">

                      <span>
                        Centers
                      </span>

                      <strong>
                        {barangay.evacuation_center_count ?? 0}
                      </strong>

                    </div>

                  </div>

                  <button
                    className="view-button"
                    onClick={() =>
                      openBarangay(barangay.id)
                    }
                    disabled={detailLoading}
                  >

                    <span>
                      {detailLoading
                        ? "Loading..."
                        : "View Barangay"}
                    </span>

                    <FontAwesomeIcon
                      icon={
                        detailLoading
                          ? faRotate
                          : faArrowRight
                      }
                      spin={detailLoading}
                    />

                  </button>

                </div>

              ))}

            </div>

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

                  <span>
                    Household Head
                  </span>

                  <strong>
                    {selectedFamily.head_name || "—"}
                  </strong>

                </div>

              </div>

              <div className="family-summary-item">

                <div className="family-summary-icon">
                  <FontAwesomeIcon icon={faPhone} />
                </div>

                <div>

                  <span>
                    Contact
                  </span>

                  <strong>
                    {selectedFamily.contact_number || "—"}
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
import { useState, useEffect } from "react";
import { api } from "../services/api";
import DashboardMap from "./DashboardMap";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
  faPlus,
  faRotateLeft,
  faCheck,
  faXmark,
  faFloppyDisk,
  faPen,
  faUsers,
  faDrawPolygon,
  faDoorOpen,
  faHouseFlag,
  faChevronDown,
  faLocationDot,
  faMapLocationDot,
  faCircleInfo,
} from "@fortawesome/free-solid-svg-icons";

const MOBILE_BREAKPOINT = 640;

function useIsMobile(breakpoint = MOBILE_BREAKPOINT) {
  const [isMobile, setIsMobile] = useState(
    typeof window !== "undefined" ? window.innerWidth < breakpoint : false
  );

  useEffect(() => {
    function handleResize() {
      setIsMobile(window.innerWidth < breakpoint);
    }

    window.addEventListener("resize", handleResize);

    return () => {
      window.removeEventListener("resize", handleResize);
    };
  }, [breakpoint]);

  return isMobile;
}

function polygonToPoints(geometry) {
  if (!geometry || !geometry.coordinates) {
    return [];
  }

  const ring = geometry.coordinates[0];

  if (!ring || ring.length < 4) {
    return [];
  }

  const points = ring.slice(0, ring.length - 1);

  return points.map(([lng, lat]) => ({
    lat,
    lng,
  }));
}

/*
 * Normalizes the getRoomFamilies response and removes duplicate
 * rows (a family repeated because the backend returns one row per
 * member).
 */
function normalizeRoomFamilies(data, capacity = 0) {
  const raw = Array.isArray(data)
    ? data
    : Array.isArray(data?.families)
    ? data.families
    : [];

  const seen = new Set();

  const families = raw.filter((family) => {
    const key = [
      family.household_head_name,
      family.address,
      family.barangay,
    ]
      .map((value) => String(value ?? "").trim().toLowerCase())
      .join("|");

    if (seen.has(key)) return false;

    seen.add(key);
    return true;
  });

  const occupied = families.reduce(
    (total, family) => total + Number(family.family_members || 0),
    0
  );

  return {
    families,
    occupied,
    available: Math.max(Number(capacity || 0) - occupied, 0),
  };
}

function EvacuationCenterManager({
  centers,
  hazardZones,
  onRefresh,
  canDeactivate,
}) {
  const [step, setStep] = useState("idle");

  const [barangays, setBarangays] = useState([]);
  const [loadingBarangays, setLoadingBarangays] = useState(false);
  const [selectedBarangayId, setSelectedBarangayId] = useState("");
  const [selectedBarangayName, setSelectedBarangayName] = useState("");
  const [availableCenters, setAvailableCenters] = useState([]);
  const [loadingCenters, setLoadingCenters] = useState(false);
  const [selectedCenterId, setSelectedCenterId] = useState("");

  const [footprintPoints, setFootprintPoints] = useState([]);
  const [entrancePoints, setEntrancePoints] = useState([]);
  const [editingCenter, setEditingCenter] = useState(null);

  /*
   * These rooms are only for the editor.
   *
   * DashboardMap independently loads saved rooms
   * from the database.
   */
  const [rooms, setRooms] = useState([]);
  const [selectedRoom, setSelectedRoom] = useState(null);
  const [roomLocation, setRoomLocation] = useState(null);
  const [savingRoomLocation, setSavingRoomLocation] = useState(false);

  /*
   * Families already assigned to the selected room.
   *
   * This is only for viewing room assignments.
   * There is no assignment/reassignment UI here.
   */
  const [assignedFamilies, setAssignedFamilies] = useState([]);
  const [roomOccupied, setRoomOccupied] = useState(0);
  const [roomAvailable, setRoomAvailable] = useState(0);
  const [loadingAssignedFamilies, setLoadingAssignedFamilies] =
    useState(false);

  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  const isMobile = useIsMobile();

  function normalizeBarangays(data) {
    if (Array.isArray(data)) return data;
    if (Array.isArray(data?.barangays)) return data.barangays;
    if (Array.isArray(data?.data)) return data.data;
    return [];
  }

  function normalizeCenters(data) {
    if (Array.isArray(data)) return data;
    if (Array.isArray(data?.centers)) return data.centers;
    if (Array.isArray(data?.evacuation_centers)) {
      return data.evacuation_centers;
    }
    if (Array.isArray(data?.features)) return data.features;
    if (Array.isArray(data?.data)) return data.data;
    return [];
  }

  function getBarangayId(barangay) {
    return barangay?.id ?? barangay?.barangay_id ?? barangay?.value ?? "";
  }

  function getBarangayName(barangay) {
    return (
      barangay?.name ??
      barangay?.barangay ??
      barangay?.barangay_name ??
      barangay?.label ??
      ""
    );
  }

  function getCenterProperties(center) {
    return center?.properties || center || {};
  }

  function getCenterId(center) {
    return getCenterProperties(center).id;
  }

  function getCenterName(center) {
    return getCenterProperties(center).name || "Unnamed Center";
  }

  function getCenterBarangay(center) {
    const properties = getCenterProperties(center);

    return properties.barangay || properties.barangay_name || "";
  }

  function getCenterBarangayId(center) {
    const properties = getCenterProperties(center);

    return properties.barangay_id || properties.barangayId || "";
  }

  function getCenterCapacity(center) {
    return getCenterProperties(center).capacity;
  }

  function getCenterBuildingMaterial(center) {
    return getCenterProperties(center).building_material;
  }

  function getCenterAccessibility(center) {
    return getCenterProperties(center).accessibility_notes;
  }

  function getCenterContact(center) {
    return getCenterProperties(center).contact_number;
  }

  function getCenterIsActive(center) {
    return getCenterProperties(center).is_active;
  }

  function getRoomId(room) {
    return room?.id;
  }

  function getRoomNumber(room) {
    return room?.room_number || room?.roomNumber || "Unnamed Room";
  }

  function getRoomCapacity(room) {
    return room?.capacity ?? 0;
  }

  function getRoomLatitude(room) {
    if (
      room?.latitude === null ||
      room?.latitude === undefined ||
      room?.latitude === ""
    ) {
      return null;
    }

    const value = Number(room.latitude);

    return Number.isFinite(value) ? value : null;
  }

  function getRoomLongitude(room) {
    if (
      room?.longitude === null ||
      room?.longitude === undefined ||
      room?.longitude === ""
    ) {
      return null;
    }

    const value = Number(room.longitude);

    return Number.isFinite(value) ? value : null;
  }

  function isRoomMapped(room) {
    return getRoomLatitude(room) !== null && getRoomLongitude(room) !== null;
  }

  async function loadBarangays() {
    setLoadingBarangays(true);
    setError("");

    try {
      const data = await api.getBarangays();

      setBarangays(normalizeBarangays(data));
    } catch (err) {
      console.error("FAILED TO LOAD BARANGAYS:", err);

      setBarangays([]);

      setError(err.message || "Failed to load barangays.");
    } finally {
      setLoadingBarangays(false);
    }
  }

  useEffect(() => {
    loadBarangays();
  }, []);

  async function loadCentersForBarangay(barangayId) {
    if (!barangayId) {
      setAvailableCenters([]);
      return;
    }

    setLoadingCenters(true);
    setError("");

    try {
      const data = await api.getBarangay(barangayId);

      const loadedCenters = normalizeCenters(
        data?.evacuation_centers ?? data?.centers ?? data
      );

      setAvailableCenters(loadedCenters);
    } catch (err) {
      console.error("FAILED TO LOAD BARANGAY DETAILS:", err);

      setAvailableCenters([]);

      setError(err.message || "Failed to load evacuation centers.");
    } finally {
      setLoadingCenters(false);
    }
  }

  function clearRoomDetails() {
    setSelectedRoom(null);
    setAssignedFamilies([]);
    setRoomOccupied(0);
    setRoomAvailable(0);
    setLoadingAssignedFamilies(false);
  }

  function startAdding() {
    setSelectedBarangayId("");
    setSelectedBarangayName("");
    setSelectedCenterId("");
    setAvailableCenters([]);
    setEditingCenter(null);
    setFootprintPoints([]);
    setEntrancePoints([]);
    setRooms([]);
    clearRoomDetails();
    setRoomLocation(null);
    setError("");
    setStep("select-center");
  }

  async function handleBarangayChange(barangayId) {
    setSelectedBarangayId(barangayId);
    setSelectedCenterId("");
    setEditingCenter(null);
    setAvailableCenters([]);
    setRooms([]);
    setFootprintPoints([]);
    setEntrancePoints([]);
    clearRoomDetails();
    setRoomLocation(null);
    setError("");

    if (!barangayId) {
      setSelectedBarangayName("");
      return;
    }

    const selectedBarangay = barangays.find(
      (barangay) => String(getBarangayId(barangay)) === String(barangayId)
    );

    setSelectedBarangayName(
      selectedBarangay ? getBarangayName(selectedBarangay) : ""
    );

    await loadCentersForBarangay(barangayId);
  }

  async function handleCenterSelection(centerId) {
    setSelectedCenterId(centerId);
    clearRoomDetails();
    setRoomLocation(null);
    setError("");

    if (!centerId) {
      setEditingCenter(null);
      setRooms([]);
      setFootprintPoints([]);
      setEntrancePoints([]);
      return;
    }

    const center = availableCenters.find(
      (item) => String(getCenterId(item)) === String(centerId)
    );

    if (!center) {
      setEditingCenter(null);
      setRooms([]);
      return;
    }

    setEditingCenter(center);

    setFootprintPoints(polygonToPoints(center.geometry));

    setEntrancePoints(center.properties?.entrances || []);

    await loadRooms(getCenterId(center));
  }

  async function startEditing(center) {
    const centerId = getCenterId(center);
    const centerBarangayId = getCenterBarangayId(center);
    const centerBarangay = getCenterBarangay(center);

    setEditingCenter(center);

    let matchingBarangay = barangays.find(
      (barangay) => String(getBarangayId(barangay)) === String(centerBarangayId)
    );

    if (!matchingBarangay) {
      matchingBarangay = barangays.find(
        (barangay) =>
          String(getBarangayName(barangay)).trim().toLowerCase() ===
          String(centerBarangay).trim().toLowerCase()
      );
    }

    if (matchingBarangay) {
      const barangayId = getBarangayId(matchingBarangay);

      setSelectedBarangayId(String(barangayId));

      setSelectedBarangayName(getBarangayName(matchingBarangay));

      await loadCentersForBarangay(barangayId);
    } else {
      setSelectedBarangayName(centerBarangay);
    }

    setSelectedCenterId(String(centerId));

    setFootprintPoints(polygonToPoints(center.geometry));

    setEntrancePoints(center.properties?.entrances || []);

    clearRoomDetails();
    setRoomLocation(null);
    setError("");

    await loadRooms(centerId);

    setStep("center-info");
  }

  function startMappingSelectedCenter() {
    if (!editingCenter) {
      setError("Please select an evacuation center.");
      return;
    }

    if (!selectedBarangayId) {
      setError("Please select a barangay.");
      return;
    }

    const selectedCenter = availableCenters.find(
      (center) =>
        String(getCenterId(center)) === String(getCenterId(editingCenter))
    );

    if (!selectedCenter) {
      setError("The selected evacuation center does not belong to this barangay.");
      return;
    }

    const centerBarangayId = getCenterBarangayId(selectedCenter);

    if (
      centerBarangayId &&
      String(centerBarangayId) !== String(selectedBarangayId)
    ) {
      setError("The selected evacuation center does not belong to this barangay.");
      return;
    }

    setEditingCenter(selectedCenter);

    const existingFootprint = polygonToPoints(selectedCenter.geometry);

    const existingEntrances = selectedCenter.properties?.entrances || [];

    setFootprintPoints(existingFootprint);

    setEntrancePoints(existingEntrances);

    clearRoomDetails();
    setRoomLocation(null);
    setError("");

    if (existingFootprint.length < 3) {
      setStep("footprint");
      return;
    }

    if (existingEntrances.length < 1) {
      setStep("entrance");
      return;
    }

    setStep("map-confirm");
  }

  function startRedrawPolygon() {
    if (!editingCenter) {
      setError("Please select an evacuation center first.");
      return;
    }

    clearRoomDetails();
    setRoomLocation(null);
    setFootprintPoints([]);
    setError("");
    setStep("footprint");
  }

  function startRedoEntrance() {
    if (!editingCenter) {
      setError("Please select an evacuation center first.");
      return;
    }

    if (footprintPoints.length < 3) {
      setError("The building footprint needs at least 3 points first.");
      return;
    }

    clearRoomDetails();
    setRoomLocation(null);
    setEntrancePoints([]);
    setError("");
    setStep("entrance");
  }

  function cancelAll() {
    setStep("idle");
    setSelectedBarangayId("");
    setSelectedBarangayName("");
    setSelectedCenterId("");
    setAvailableCenters([]);
    setEditingCenter(null);
    setFootprintPoints([]);
    setEntrancePoints([]);
    setRooms([]);
    clearRoomDetails();
    setRoomLocation(null);
    setError("");
  }

  function handleMapClick(latlng) {
    if (step === "footprint") {
      setFootprintPoints((points) => [...points, latlng]);

      return;
    }

    if (step === "entrance") {
      setEntrancePoints((points) => [...points, latlng]);

      return;
    }

    if (step === "room-map") {
      if (!selectedRoom) {
        setError("Please select a room first.");
        return;
      }

      setRoomLocation({
        lat: Number(latlng.lat),
        lng: Number(latlng.lng),
      });

      setError("");
    }
  }

  function undoLastPoint() {
    setFootprintPoints((points) => points.slice(0, -1));
  }

  function finishFootprint() {
    if (footprintPoints.length < 3) {
      setError("Trace at least 3 points to outline the building.");
      return;
    }

    setError("");

    if (entrancePoints.length >= 1) {
      setStep("map-confirm");
    } else {
      setStep("entrance");
    }
  }

  function redrawFootprint() {
    setFootprintPoints([]);
    setError("");
    setStep("footprint");
  }

  function undoLastEntrance() {
    setEntrancePoints((points) => points.slice(0, -1));
  }

  function finishEntrances() {
    if (entrancePoints.length < 1) {
      setError("Place at least one entrance point.");
      return;
    }

    setError("");
    setStep("map-confirm");
  }

  function repositionEntrances() {
    setEntrancePoints([]);
    setError("");
    setStep("entrance");
  }

  async function loadRooms(centerId) {
    if (!centerId) {
      setRooms([]);
      return;
    }

    try {
      const data = await api.getRooms(centerId);

      let loadedRooms = [];

      if (Array.isArray(data)) {
        loadedRooms = data;
      } else if (Array.isArray(data?.rooms)) {
        loadedRooms = data.rooms;
      } else if (Array.isArray(data?.data)) {
        loadedRooms = data.data;
      }

      setRooms(loadedRooms);
    } catch (err) {
      console.error("FAILED TO LOAD ROOMS:", err);

      setRooms([]);

      setError(err.message || "Failed to load rooms.");
    }
  }

  function startRoomMapping() {
    if (!editingCenter) {
      setError("Please select an evacuation center first.");
      return;
    }

    if (rooms.length === 0) {
      setError(
        "No rooms were found for this evacuation center. Make sure the rooms were imported from Excel."
      );
      return;
    }

    clearRoomDetails();
    setRoomLocation(null);
    setError("");
    setStep("room-map");
  }

  function handleRoomSelection(roomId) {
    if (!roomId) {
      clearRoomDetails();
      setRoomLocation(null);
      setError("");
      return;
    }

    const room = rooms.find((item) => String(getRoomId(item)) === String(roomId));

    if (!room) {
      clearRoomDetails();
      setRoomLocation(null);
      setError("The selected room could not be found.");
      return;
    }

    setSelectedRoom(room);
    setRoomLocation(null);
    setError("");
  }

  async function handleRoomClick(room) {
    /*
     * During room mapping, clicking a room only
     * selects that room for location mapping.
     */
    if (step === "room-map") {
      setSelectedRoom(room);
      setRoomLocation(null);
      setError("");
      return;
    }

    /*
     * Outside room mapping, clicking a room only
     * shows the families already assigned to it.
     */
    setSelectedRoom(room);
    setRoomLocation(null);
    setAssignedFamilies([]);
    setRoomOccupied(0);
    setRoomAvailable(Number(room.capacity || 0));
    setError("");
    setLoadingAssignedFamilies(true);

    try {
      const data = await api.getRoomFamilies(room.id);

      const result = normalizeRoomFamilies(data, room.capacity);

      setAssignedFamilies(result.families);
      setRoomOccupied(result.occupied);
      setRoomAvailable(result.available);
    } catch (err) {
      console.error("FAILED TO LOAD ASSIGNED FAMILIES:", err);

      setAssignedFamilies([]);
      setRoomOccupied(0);
      setRoomAvailable(Number(room.capacity || 0));

      setError(err.message || "Failed to load assigned families.");
    } finally {
      setLoadingAssignedFamilies(false);
    }
  }

  async function handleSaveRoomLocation() {
    if (!editingCenter) {
      setError("Please select an evacuation center first.");
      return;
    }

    if (!selectedRoom) {
      setError("Please select a room first.");
      return;
    }

    if (!roomLocation) {
      setError("Click the map to place the selected room.");
      return;
    }

    const latitude = Number(roomLocation.lat);
    const longitude = Number(roomLocation.lng);

    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
      setError("The selected room location is invalid.");
      return;
    }

    setSavingRoomLocation(true);
    setError("");

    try {
      const response = await api.updateRoomLocation(selectedRoom.id, {
        latitude,
        longitude,
      });

      const updatedRoom = response?.room || {
        ...selectedRoom,
        latitude,
        longitude,
      };

      const finalRoom = {
        ...selectedRoom,
        ...updatedRoom,
        latitude,
        longitude,
        evacuation_center_id:
          selectedRoom.evacuation_center_id ?? getCenterId(editingCenter),
      };

      setRooms((currentRooms) =>
        currentRooms.map((room) =>
          String(room.id) === String(selectedRoom.id) ? finalRoom : room
        )
      );

      setSelectedRoom(finalRoom);

      setRoomLocation(null);
      setError("");

      await loadRooms(getCenterId(editingCenter));
    } catch (err) {
      console.error("FAILED TO UPDATE ROOM LOCATION:", err);

      setError(err.message || "Failed to save the room location.");
    } finally {
      setSavingRoomLocation(false);
    }
  }

  function finishRoomMapping() {
    clearRoomDetails();
    setRoomLocation(null);
    setError("");
    setStep("map-confirm");
  }

  async function handleSaveMap() {
    if (!editingCenter) {
      setError("Please select an evacuation center first.");
      return;
    }

    if (footprintPoints.length < 3) {
      setError("The building footprint needs at least 3 points.");
      return;
    }

    if (entrancePoints.length < 1) {
      setError("Place at least one entrance before saving.");
      return;
    }

    setSaving(true);
    setError("");

    try {
      await api.updateEvacuationCenter(getCenterId(editingCenter), {
        polygon: footprintPoints,
        entrances: entrancePoints,
      });

      cancelAll();

      if (onRefresh) {
        await onRefresh();
      }
    } catch (err) {
      setError(err.message || "Failed to save the evacuation center location.");
    } finally {
      setSaving(false);
    }
  }

  async function handleToggleActive(center) {
    const active = getCenterIsActive(center);

    const name = getCenterName(center);

    if (!confirm(`${active ? "Deactivate" : "Reactivate"} "${name}"?`)) {
      return;
    }

    try {
      await api.toggleCenterActive(getCenterId(center));

      if (onRefresh) {
        await onRefresh();
      }

      if (
        editingCenter &&
        getCenterId(editingCenter) === getCenterId(center)
      ) {
        cancelAll();
      }
    } catch (err) {
      setError(err.message || "Failed to change center status.");
    }
  }

  function closeRoomPanel() {
    clearRoomDetails();
    setError("");
  }

  const mapDrawMode =
    step === "footprint"
      ? "footprint"
      : step === "entrance"
      ? "entrance"
      : step === "room-map"
      ? "room"
      : "none";

  const mappedRooms = rooms.filter((room) => isRoomMapped(room)).length;

  const unmappedRooms = rooms.length - mappedRooms;

  const showMobileCenterToolbar =
    isMobile &&
    editingCenter &&
    ["center-info", "footprint", "entrance", "room-map", "map-confirm"].includes(
      step
    );

  return (
    <div
      style={{
        display: "flex",
        flexDirection: isMobile ? "column" : "row",
        height: "100%",
      }}
    >
      <style>{FORM_CSS}</style>

      <div
        style={{
          flex: 1,
          position: "relative",
          minHeight: isMobile ? "40%" : "auto",
        }}
      >
        <DashboardMap
          centers={centers}
          hazardZones={hazardZones}
          onCenterClick={startEditing}
          drawMode={mapDrawMode}
          onMapClick={handleMapClick}
          pendingFootprint={footprintPoints}
          pendingEntrances={entrancePoints}
          rooms={rooms}
          onRoomClick={handleRoomClick}
          pendingRoomLocation={roomLocation}
        />

        {showMobileCenterToolbar && (
          <div style={styles.mobileCenterToolbar}>
            <button
              onClick={() => {
                clearRoomDetails();
                setRoomLocation(null);
                setError("");
                setStep("center-info");
              }}
              style={{
                ...styles.mobileToolbarButton,
                ...(step === "center-info"
                  ? styles.mobileToolbarButtonActive
                  : {}),
              }}
              title="Center Information"
            >
              <FontAwesomeIcon icon={faCircleInfo} />
            </button>

            <button
              onClick={startRoomMapping}
              disabled={rooms.length === 0}
              style={{
                ...styles.mobileToolbarButton,
                ...(step === "room-map" ? styles.mobileToolbarButtonActive : {}),
                ...(rooms.length === 0 ? styles.mobileToolbarDisabled : {}),
              }}
              title="Map Rooms"
            >
              <FontAwesomeIcon icon={faMapLocationDot} />
            </button>

            <button
              onClick={startRedrawPolygon}
              style={{
                ...styles.mobileToolbarButton,
                ...(step === "footprint"
                  ? styles.mobileToolbarButtonActive
                  : {}),
              }}
              title="Redraw Polygon"
            >
              <FontAwesomeIcon icon={faDrawPolygon} />
            </button>

            <button
              onClick={startRedoEntrance}
              style={{
                ...styles.mobileToolbarButton,
                ...(step === "entrance" ? styles.mobileToolbarButtonActive : {}),
              }}
              title="Redo Entrance"
            >
              <FontAwesomeIcon icon={faDoorOpen} />
            </button>

            <button
              onClick={cancelAll}
              style={{
                ...styles.mobileToolbarButton,
                ...styles.mobileToolbarClose,
              }}
              title="Close"
            >
              <FontAwesomeIcon icon={faXmark} />
            </button>
          </div>
        )}

        {step === "center-info" && editingCenter && (
          <div
            style={{
              ...styles.centerInfoPanel,
              ...(isMobile ? styles.centerInfoPanelMobile : {}),
            }}
          >
            <div style={styles.centerInfoHeader}>
              <div style={styles.centerInfoTitle}>
                <FontAwesomeIcon icon={faCircleInfo} />

                <span>Evacuation Center</span>
              </div>

              {!isMobile && (
                <button
                  onClick={cancelAll}
                  style={styles.centerInfoClose}
                  title="Close"
                >
                  <FontAwesomeIcon icon={faXmark} />
                </button>
              )}
            </div>

            <div style={styles.centerInfoName}>{getCenterName(editingCenter)}</div>

            <div style={styles.centerInfoDetails}>
              <div style={styles.centerInfoRow}>
                <span>Barangay</span>

                <strong>
                  {selectedBarangayName ||
                    getCenterBarangay(editingCenter) ||
                    "Not set"}
                </strong>
              </div>

              <div style={styles.centerInfoRow}>
                <span>Capacity</span>

                <strong>{getCenterCapacity(editingCenter) || "Not set"}</strong>
              </div>

              <div style={styles.centerInfoRow}>
                <span>Building</span>

                <strong>
                  {getCenterBuildingMaterial(editingCenter) || "Not set"}
                </strong>
              </div>

              <div style={styles.centerInfoRow}>
                <span>Contact</span>

                <strong>{getCenterContact(editingCenter) || "Not set"}</strong>
              </div>

              {getCenterAccessibility(editingCenter) && (
                <div style={styles.centerInfoAccessibility}>
                  <span>Accessibility</span>

                  <div>{getCenterAccessibility(editingCenter)}</div>
                </div>
              )}
            </div>

            {!isMobile && (
              <div style={styles.centerActions}>
                <button
                  onClick={startRoomMapping}
                  disabled={rooms.length === 0}
                  style={{
                    ...styles.centerActionButton,
                    ...styles.centerActionPrimary,
                    opacity: rooms.length > 0 ? 1 : 0.5,
                  }}
                >
                  <FontAwesomeIcon icon={faMapLocationDot} />

                  <span>Map Rooms</span>
                </button>

                <button
                  onClick={startRedrawPolygon}
                  style={{
                    ...styles.centerActionButton,
                    ...styles.centerActionSecondary,
                  }}
                >
                  <FontAwesomeIcon icon={faDrawPolygon} />

                  <span>Redraw Polygon</span>
                </button>

                <button
                  onClick={startRedoEntrance}
                  style={{
                    ...styles.centerActionButton,
                    ...styles.centerActionSecondary,
                  }}
                >
                  <FontAwesomeIcon icon={faDoorOpen} />

                  <span>Redo Entrance</span>
                </button>

                <button
                  onClick={cancelAll}
                  style={{
                    ...styles.centerActionButton,
                    ...styles.centerActionClose,
                  }}
                >
                  <FontAwesomeIcon icon={faXmark} />

                  <span>Close</span>
                </button>
              </div>
            )}
          </div>
        )}

        {selectedRoom && step !== "room-map" && (
          <div
            style={{
              ...styles.familyPanel,
              ...(isMobile ? styles.familyPanelMobile : {}),
            }}
          >
            <div style={styles.drawTitle}>
              <FontAwesomeIcon icon={faUsers} />

              {getRoomNumber(selectedRoom)}
            </div>

            <div style={styles.drawHint}>
              Capacity: {getRoomCapacity(selectedRoom)} people
            </div>

            <div style={styles.roomOccupancy}>
              <div style={styles.roomOccupancyItem}>
                <span style={styles.roomOccupancyLabel}>Occupied</span>

                <strong style={styles.roomOccupancyValue}>{roomOccupied}</strong>
              </div>

              <div style={styles.roomOccupancyItem}>
                <span style={styles.roomOccupancyLabel}>Available</span>

                <strong style={styles.roomOccupancyValue}>{roomAvailable}</strong>
              </div>
            </div>

            {error && <div style={styles.familyError}>{error}</div>}

            {loadingAssignedFamilies ? (
              <div style={styles.familyLoading}>Loading assigned families...</div>
            ) : assignedFamilies.length === 0 ? (
              <div style={styles.familyEmpty}>
                No families are assigned to this room.
              </div>
            ) : (
              <div style={styles.familyList}>
                {assignedFamilies.map((family, index) => (
                  <div
                    key={
                      family.assignment_id ??
                      family.resident_id ??
                      family.id ??
                      `${family.household_head_name}-${index}`
                    }
                    style={styles.familyItemReadonly}
                  >
                    <div style={styles.familyReadonlyIcon}>
                      <FontAwesomeIcon icon={faUsers} />
                    </div>

                    <div style={{ minWidth: 0 }}>
                      <div style={styles.familyName}>
                        {family.household_head_name}
                      </div>

                      <div style={styles.familyDetails}>
                        {family.barangay || "Barangay not set"} ·{" "}
                        {family.family_members ?? 0} member
                        {Number(family.family_members) !== 1 ? "s" : ""}
                      </div>

                      {family.address && (
                        <div style={styles.familyAddress}>{family.address}</div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}

            <div style={styles.familyActions}>
              <button onClick={closeRoomPanel} style={styles.smallBtnGhost}>
                Close
              </button>
            </div>
          </div>
        )}

        {step === "idle" && (
          <button onClick={startAdding} style={styles.addBtn}>
            <FontAwesomeIcon icon={faPlus} />

            <span>Map Evacuation Center</span>
          </button>
        )}

        {step === "select-center" && (
          <div
            style={{
              ...styles.drawPanel,
              ...(isMobile ? styles.drawPanelMobile : {}),
              width: isMobile ? "auto" : 360,
              maxWidth: isMobile ? "none" : 360,
            }}
          >
            <div style={styles.drawTitle}>
              <FontAwesomeIcon icon={faHouseFlag} />
              Select Evacuation Center
            </div>

            <div style={styles.drawHint}>
              Select the barangay and evacuation center that were imported from
              Excel.
            </div>

            {error && <div style={styles.panelError}>{error}</div>}

            <div style={{ marginTop: 12 }}>
              <label style={styles.selectLabel}>Barangay</label>

              <div style={styles.selectWrapper}>
                <select
                  value={selectedBarangayId}
                  onChange={(e) => handleBarangayChange(e.target.value)}
                  disabled={loadingBarangays}
                  style={styles.selectInput}
                >
                  <option value="">
                    {loadingBarangays ? "Loading barangays..." : "Select barangay"}
                  </option>

                  {barangays.map((barangay) => {
                    const id = getBarangayId(barangay);

                    const name = getBarangayName(barangay);

                    return (
                      <option key={id} value={id}>
                        {name}
                      </option>
                    );
                  })}
                </select>

                <FontAwesomeIcon icon={faChevronDown} style={styles.selectIcon} />
              </div>
            </div>

            <div style={{ marginTop: 12 }}>
              <label style={styles.selectLabel}>Evacuation Center</label>

              <div style={styles.selectWrapper}>
                <select
                  value={selectedCenterId}
                  disabled={!selectedBarangayId || loadingCenters}
                  onChange={(e) => handleCenterSelection(e.target.value)}
                  style={{
                    ...styles.selectInput,
                    ...(!selectedBarangayId || loadingCenters
                      ? styles.selectDisabled
                      : {}),
                  }}
                >
                  <option value="">
                    {!selectedBarangayId
                      ? "Select barangay first"
                      : loadingCenters
                      ? "Loading evacuation centers..."
                      : availableCenters.length === 0
                      ? "No evacuation centers found"
                      : "Select evacuation center"}
                  </option>

                  {availableCenters.map((center) => (
                    <option key={getCenterId(center)} value={getCenterId(center)}>
                      {getCenterName(center)}
                    </option>
                  ))}
                </select>

                <FontAwesomeIcon icon={faChevronDown} style={styles.selectIcon} />
              </div>
            </div>

            {editingCenter && (
              <div style={styles.centerPreview}>
                <div style={styles.centerPreviewTitle}>
                  {getCenterName(editingCenter)}
                </div>

                <div style={styles.centerPreviewRow}>
                  <span>Barangay</span>

                  <strong>{selectedBarangayName}</strong>
                </div>

                <div style={styles.centerPreviewRow}>
                  <span>Capacity</span>

                  <strong>{getCenterCapacity(editingCenter) || "Not set"}</strong>
                </div>

                <div style={styles.centerPreviewRow}>
                  <span>Building</span>

                  <strong>
                    {getCenterBuildingMaterial(editingCenter) || "Not set"}
                  </strong>
                </div>

                <div style={styles.centerPreviewRow}>
                  <span>Contact</span>

                  <strong>{getCenterContact(editingCenter) || "Not set"}</strong>
                </div>
              </div>
            )}

            <div
              style={{
                display: "flex",
                gap: 8,
                marginTop: 14,
                flexWrap: "wrap",
              }}
            >
              <button
                onClick={startMappingSelectedCenter}
                disabled={!selectedCenterId || loadingCenters}
                style={{
                  ...styles.smallBtnPrimary,
                  opacity: selectedCenterId && !loadingCenters ? 1 : 0.5,
                }}
              >
                <FontAwesomeIcon icon={faDrawPolygon} />

                <span>Continue to Map</span>
              </button>

              <button onClick={cancelAll} style={styles.smallBtnGhost}>
                <FontAwesomeIcon icon={faXmark} />

                <span>Cancel</span>
              </button>
            </div>
          </div>
        )}

        {step === "footprint" && (
          <div
            style={{
              ...styles.drawPanel,
              ...(isMobile ? styles.mappingPanelMobile : {}),
            }}
          >
            <div style={styles.drawTitle}>
              <FontAwesomeIcon icon={faDrawPolygon} />
              Tracing building outline
            </div>

            <div style={styles.drawHint}>
              <strong>
                {editingCenter ? getCenterName(editingCenter) : "Evacuation Center"}
              </strong>

              <br />

              Click around the building to place each corner.{" "}
              {footprintPoints.length} point
              {footprintPoints.length !== 1 ? "s" : ""} placed.
            </div>

            {error && <div style={styles.panelError}>{error}</div>}

            <div style={styles.mappingButtons}>
              <button
                onClick={undoLastPoint}
                disabled={!footprintPoints.length}
                style={styles.smallBtn}
              >
                <FontAwesomeIcon icon={faRotateLeft} />

                <span>Undo</span>
              </button>

              <button
                onClick={finishFootprint}
                disabled={footprintPoints.length < 3}
                style={styles.smallBtnPrimary}
              >
                <FontAwesomeIcon icon={faCheck} />

                <span>Finish Outline</span>
              </button>

              <button onClick={cancelAll} style={styles.smallBtnGhost}>
                <FontAwesomeIcon icon={faXmark} />

                <span>Cancel</span>
              </button>
            </div>
          </div>
        )}

        {step === "entrance" && (
          <div
            style={{
              ...styles.drawPanel,
              ...(isMobile ? styles.mappingPanelMobile : {}),
            }}
          >
            <div style={styles.drawTitle}>
              <FontAwesomeIcon icon={faDoorOpen} />
              Place entrance(s)
            </div>

            <div style={styles.drawHint}>
              <strong>
                {editingCenter ? getCenterName(editingCenter) : "Evacuation Center"}
              </strong>

              <br />

              Click each entrance evacuees can use. {entrancePoints.length}{" "}
              placed.
            </div>

            {error && <div style={styles.panelError}>{error}</div>}

            <div style={styles.mappingButtons}>
              <button
                onClick={undoLastEntrance}
                disabled={!entrancePoints.length}
                style={styles.smallBtn}
              >
                <FontAwesomeIcon icon={faRotateLeft} />

                <span>Undo</span>
              </button>

              <button
                onClick={finishEntrances}
                disabled={entrancePoints.length < 1}
                style={styles.smallBtnPrimary}
              >
                <FontAwesomeIcon icon={faCheck} />

                <span>Finish Entrances</span>
              </button>

              <button
                onClick={() => setStep("footprint")}
                style={styles.smallBtnGhost}
              >
                Back
              </button>

              <button onClick={cancelAll} style={styles.smallBtnGhost}>
                <FontAwesomeIcon icon={faXmark} />

                <span>Cancel</span>
              </button>
            </div>
          </div>
        )}

        {step === "map-confirm" && (
          <div
            style={{
              ...styles.drawPanel,
              ...(isMobile ? styles.drawPanelMobile : {}),
              width: isMobile ? "auto" : 360,
            }}
          >
            <div style={styles.drawTitle}>
              <FontAwesomeIcon icon={faHouseFlag} />
              Center Location Ready
            </div>

            <div style={styles.drawHint}>
              <strong>{editingCenter ? getCenterName(editingCenter) : ""}</strong>

              <br />

              The building footprint and entrance are ready.
            </div>

            {error && <div style={styles.panelError}>{error}</div>}

            <div
              style={{
                marginTop: 12,
                display: "grid",
                gap: 7,
              }}
            >
              <div style={styles.summaryRow}>
                <span>Barangay</span>

                <strong>{selectedBarangayName}</strong>
              </div>

              <div style={styles.summaryRow}>
                <span>Footprint</span>

                <strong>{footprintPoints.length} points</strong>
              </div>

              <div style={styles.summaryRow}>
                <span>Entrances</span>

                <strong>{entrancePoints.length}</strong>
              </div>

              <div style={styles.summaryRow}>
                <span>Rooms</span>

                <strong>{rooms.length}</strong>
              </div>

              <div style={styles.summaryRow}>
                <span>Rooms Mapped</span>

                <strong>{mappedRooms}</strong>
              </div>

              {unmappedRooms > 0 && (
                <div style={styles.roomWarning}>
                  {unmappedRooms} room{unmappedRooms !== 1 ? "s" : ""} still need
                  {unmappedRooms === 1 ? "s" : ""} a map location.
                </div>
              )}
            </div>

            <div
              style={{
                display: "flex",
                gap: 8,
                marginTop: 14,
                flexWrap: "wrap",
              }}
            >
              <button
                onClick={startRoomMapping}
                disabled={saving || rooms.length === 0}
                style={{
                  ...styles.smallBtnPrimary,
                  opacity: rooms.length > 0 && !saving ? 1 : 0.5,
                }}
              >
                <FontAwesomeIcon icon={faMapLocationDot} />

                <span>Map Rooms</span>
              </button>

              <button
                onClick={handleSaveMap}
                disabled={saving}
                style={styles.smallBtnPrimary}
              >
                <FontAwesomeIcon icon={faFloppyDisk} spin={saving} />

                <span>{saving ? "Saving..." : "Save Center Map"}</span>
              </button>

              <button
                onClick={redrawFootprint}
                disabled={saving}
                style={styles.smallBtnGhost}
              >
                <FontAwesomeIcon icon={faPen} />
                Redraw
              </button>

              <button
                onClick={repositionEntrances}
                disabled={saving}
                style={styles.smallBtnGhost}
              >
                <FontAwesomeIcon icon={faDoorOpen} />
                Redo Entrance
              </button>

              <button
                onClick={cancelAll}
                disabled={saving}
                style={styles.smallBtnGhost}
              >
                <FontAwesomeIcon icon={faXmark} />
                Cancel
              </button>
            </div>
          </div>
        )}

        {step === "room-map" && (
          <div
            style={{
              ...styles.drawPanel,
              ...(isMobile ? styles.roomMappingPanelMobile : {}),
              width: isMobile ? "auto" : 370,
              maxWidth: isMobile ? "none" : 370,
            }}
          >
            <div style={styles.drawTitle}>
              <FontAwesomeIcon icon={faMapLocationDot} />
              Map Evacuation Center Rooms
            </div>

            <div style={styles.drawHint}>
              Select an existing room imported from Excel, then click the room's
              actual location on the map.
            </div>

            {error && <div style={styles.panelError}>{error}</div>}

            <div style={{ marginTop: 12 }}>
              <label style={styles.selectLabel}>Existing Room</label>

              <div style={styles.selectWrapper}>
                <select
                  value={selectedRoom ? String(getRoomId(selectedRoom)) : ""}
                  onChange={(e) => handleRoomSelection(e.target.value)}
                  disabled={savingRoomLocation || rooms.length === 0}
                  style={styles.selectInput}
                >
                  <option value="">
                    {rooms.length === 0 ? "No rooms available" : "Select room"}
                  </option>

                  {rooms.map((room) => (
                    <option key={getRoomId(room)} value={getRoomId(room)}>
                      {getRoomNumber(room)} · Capacity {getRoomCapacity(room)}
                      {isRoomMapped(room) ? " · Mapped" : " · Not mapped"}
                    </option>
                  ))}
                </select>

                <FontAwesomeIcon icon={faChevronDown} style={styles.selectIcon} />
              </div>
            </div>

            {selectedRoom && (
              <div style={styles.roomPreview}>
                <div style={styles.roomPreviewTitle}>
                  {getRoomNumber(selectedRoom)}
                </div>

                <div style={styles.centerPreviewRow}>
                  <span>Capacity</span>

                  <strong>{getRoomCapacity(selectedRoom)} people</strong>
                </div>

                <div style={styles.centerPreviewRow}>
                  <span>Status</span>

                  <strong
                    style={{
                      color: isRoomMapped(selectedRoom) ? "#15803d" : "#b45309",
                    }}
                  >
                    {isRoomMapped(selectedRoom) ? "Already mapped" : "Not mapped"}
                  </strong>
                </div>

                {isRoomMapped(selectedRoom) && (
                  <div style={styles.roomCoordinates}>
                    Current location: {getRoomLatitude(selectedRoom).toFixed(6)},{" "}
                    {getRoomLongitude(selectedRoom).toFixed(6)}
                  </div>
                )}
              </div>
            )}

            {selectedRoom && (
              <div
                style={{
                  marginTop: 12,
                  padding: "10px 11px",
                  background: roomLocation ? "#ecfdf5" : "#eff6ff",
                  border: roomLocation
                    ? "1px solid #bbf7d0"
                    : "1px solid #bfdbfe",
                  borderRadius: 8,
                  fontSize: 12,
                  lineHeight: 1.45,
                }}
              >
                <div
                  style={{
                    fontWeight: 700,
                    color: roomLocation ? "#166534" : "#1d4ed8",
                  }}
                >
                  <FontAwesomeIcon
                    icon={faLocationDot}
                    style={{ marginRight: 6 }}
                  />

                  {roomLocation
                    ? "New room location selected"
                    : "Click the map to place this room"}
                </div>

                {roomLocation && (
                  <div style={{ marginTop: 4, color: "#555" }}>
                    Latitude: {roomLocation.lat.toFixed(6)}

                    <br />

                    Longitude: {roomLocation.lng.toFixed(6)}
                  </div>
                )}
              </div>
            )}

            <div style={styles.roomMapSummary}>
              <span>Rooms mapped</span>

              <strong>
                {mappedRooms} / {rooms.length}
              </strong>
            </div>

            <div
              style={{
                display: "flex",
                gap: 8,
                marginTop: 14,
                flexWrap: "wrap",
              }}
            >
              <button
                onClick={handleSaveRoomLocation}
                disabled={savingRoomLocation || !selectedRoom || !roomLocation}
                style={{
                  ...styles.smallBtnPrimary,
                  opacity:
                    selectedRoom && roomLocation && !savingRoomLocation ? 1 : 0.5,
                }}
              >
                <FontAwesomeIcon icon={faFloppyDisk} spin={savingRoomLocation} />

                <span>
                  {savingRoomLocation ? "Saving..." : "Save Room Location"}
                </span>
              </button>

              <button
                onClick={() => {
                  setSelectedRoom(null);

                  setRoomLocation(null);

                  setError("");
                }}
                disabled={savingRoomLocation}
                style={styles.smallBtnGhost}
              >
                <FontAwesomeIcon icon={faXmark} />
                Clear
              </button>

              <button
                onClick={finishRoomMapping}
                disabled={savingRoomLocation}
                style={styles.smallBtnGhost}
              >
                <FontAwesomeIcon icon={faCheck} />
                Done
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

const FORM_CSS = `
.ecm-overlay {
  position: fixed;
  inset: 0;
  background: rgba(17, 24, 39, 0.5);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 20px;
  z-index: 2000;
}

.ecm-modal {
  width: 100%;
  max-width: 460px;
  max-height: 88vh;
  background: #ffffff;
  border-radius: 16px;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  box-shadow: 0 20px 60px rgba(17, 24, 39, 0.25);
}

.ecm-modal-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 18px 20px;
  border-bottom: 1px solid #f0f0f0;
}

.ecm-modal-title {
  display: flex;
  align-items: center;
  gap: 10px;
}

.ecm-modal-title h3 {
  margin: 0;
  font-size: 16px;
  font-weight: 700;
  color: #111827;
}

.ecm-modal-title-icon {
  color: #2563eb;
}

.ecm-close-btn {
  width: 30px;
  height: 30px;
  border-radius: 999px;
  border: none;
  background: #f3f4f6;
  color: #6b7280;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
}

.ecm-modal-body {
  padding: 20px;
  overflow-y: auto;
  flex: 1;
}

.ecm-error {
  background: #fee2e2;
  color: #991b1b;
  padding: 10px 12px;
  border-radius: 8px;
  font-size: 13px;
  margin-bottom: 14px;
}

.ecm-modal-footer {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 16px 20px;
  border-top: 1px solid #f0f0f0;
}

.ecm-footer-spacer {
  flex: 1;
}

@media (max-width: 640px) {
  .ecm-overlay {
    padding: 0;
    align-items: flex-end;
  }

  .ecm-modal {
    max-width: 100%;
    max-height: 92vh;
    border-radius: 16px 16px 0 0;
  }
}
`;

const styles = {
  addBtn: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    position: "absolute",
    bottom: 20,
    left: "50%",
    transform: "translateX(-50%)",
    zIndex: 1000,
    padding: "12px 20px",
    borderRadius: 30,
    border: "none",
    background: "#2563eb",
    color: "white",
    fontWeight: 600,
    fontSize: 14,
    cursor: "pointer",
    boxShadow: "0 4px 14px rgba(37,99,235,0.4)",
    whiteSpace: "nowrap",
  },

  drawPanel: {
    position: "absolute",
    top: 16,
    left: 16,
    zIndex: 1000,
    background: "white",
    padding: "14px 16px",
    borderRadius: 10,
    boxShadow: "0 4px 14px rgba(0,0,0,0.18)",
    maxWidth: 360,
  },

  drawPanelMobile: {
    top: "auto",
    bottom: 16,
    left: 12,
    right: 12,
    maxWidth: "none",
    maxHeight: "55vh",
    overflowY: "auto",
  },

  mappingPanelMobile: {
    top: "auto",
    bottom: 12,
    left: 60,
    right: 12,
    maxWidth: "none",
    maxHeight: "34vh",
    overflowY: "auto",
    padding: "10px 12px",
  },

  roomMappingPanelMobile: {
    top: "auto",
    bottom: 12,
    left: 60,
    right: 12,
    maxWidth: "none",
    maxHeight: "48vh",
    overflowY: "auto",
    padding: "10px 12px",
  },

  drawTitle: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    fontWeight: 700,
    fontSize: 14,
    color: "#1e3a8a",
    marginBottom: 4,
  },

  drawHint: {
    fontSize: 12.5,
    color: "#555",
    lineHeight: 1.4,
  },

  mappingButtons: {
    display: "flex",
    gap: 8,
    marginTop: 10,
    flexWrap: "wrap",
  },

  smallBtn: {
    display: "flex",
    alignItems: "center",
    gap: 6,
    padding: "7px 10px",
    borderRadius: 6,
    border: "1px solid #ccc",
    background: "white",
    fontSize: 12.5,
    cursor: "pointer",
  },

  smallBtnPrimary: {
    display: "flex",
    alignItems: "center",
    gap: 6,
    padding: "7px 10px",
    borderRadius: 6,
    border: "none",
    background: "#2563eb",
    color: "white",
    fontSize: 12.5,
    fontWeight: 600,
    cursor: "pointer",
  },

  smallBtnGhost: {
    display: "flex",
    alignItems: "center",
    gap: 6,
    padding: "7px 10px",
    borderRadius: 6,
    border: "1px solid #ddd",
    background: "transparent",
    color: "#666",
    fontSize: 12.5,
    cursor: "pointer",
  },

  centerInfoPanel: {
    position: "absolute",
    top: 16,
    left: 16,
    zIndex: 1100,
    width: 340,
    maxWidth: "calc(100% - 32px)",
    background: "white",
    borderRadius: 12,
    boxShadow: "0 5px 18px rgba(0,0,0,0.2)",
    overflow: "hidden",
  },

  centerInfoPanelMobile: {
    top: 12,
    left: 60,
    right: 12,
    bottom: "auto",
    width: "auto",
    maxWidth: "none",
    maxHeight: "65vh",
    overflowY: "auto",
  },

  centerInfoHeader: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    padding: "12px 14px",
    borderBottom: "1px solid #e5e7eb",
  },

  centerInfoTitle: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    fontSize: 13,
    fontWeight: 700,
    color: "#1e3a8a",
  },

  centerInfoClose: {
    width: 30,
    height: 30,
    borderRadius: 7,
    border: "none",
    background: "#f3f4f6",
    color: "#666",
    cursor: "pointer",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
  },

  centerInfoName: {
    padding: "13px 14px 4px",
    fontSize: 16,
    fontWeight: 700,
    color: "#111827",
  },

  centerInfoDetails: {
    padding: "4px 14px 12px",
  },

  centerInfoRow: {
    display: "flex",
    justifyContent: "space-between",
    gap: 12,
    padding: "5px 0",
    fontSize: 11.5,
    color: "#6b7280",
  },

  centerInfoAccessibility: {
    marginTop: 5,
    paddingTop: 8,
    borderTop: "1px solid #e5e7eb",
    fontSize: 11.5,
    color: "#6b7280",
  },

  centerActions: {
    display: "grid",
    gridTemplateColumns: "1fr 1fr",
    gap: 7,
    padding: "12px 14px 14px",
    borderTop: "1px solid #e5e7eb",
  },

  centerActionButton: {
    minHeight: 38,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    gap: 7,
    borderRadius: 7,
    fontSize: 12,
    fontWeight: 600,
    cursor: "pointer",
  },

  centerActionPrimary: {
    border: "none",
    background: "#2563eb",
    color: "white",
  },

  centerActionSecondary: {
    border: "1px solid #d1d5db",
    background: "#ffffff",
    color: "#374151",
  },

  centerActionClose: {
    border: "1px solid #e5e7eb",
    background: "#f9fafb",
    color: "#6b7280",
  },

  mobileCenterToolbar: {
    position: "absolute",
    top: 12,
    left: 10,
    zIndex: 1300,
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    gap: 5,
    padding: 5,
    background: "#ffffff",
    border: "1px solid #e5e7eb",
    borderRadius: 10,
    boxShadow: "0 3px 12px rgba(0,0,0,0.15)",
  },

  mobileToolbarButton: {
    width: 38,
    height: 38,
    padding: 0,
    border: "none",
    borderRadius: 7,
    background: "#f8fafc",
    color: "#374151",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    fontSize: 15,
    cursor: "pointer",
  },

  mobileToolbarButtonActive: {
    background: "#2563eb",
    color: "#ffffff",
  },

  mobileToolbarDisabled: {
    background: "#f3f4f6",
    color: "#c4c7cc",
    cursor: "not-allowed",
  },

  mobileToolbarClose: {
    background: "#fef2f2",
    color: "#dc2626",
  },

  selectLabel: {
    display: "block",
    fontSize: 12,
    fontWeight: 700,
    color: "#555",
    marginBottom: 5,
  },

  selectWrapper: {
    position: "relative",
  },

  selectInput: {
    width: "100%",
    boxSizing: "border-box",
    appearance: "none",
    padding: "9px 34px 9px 10px",
    border: "1px solid #ccc",
    borderRadius: 7,
    background: "#ffffff",
    color: "#222",
    fontSize: 13,
    cursor: "pointer",
  },

  selectDisabled: {
    background: "#f3f4f6",
    color: "#999",
    cursor: "not-allowed",
  },

  selectIcon: {
    position: "absolute",
    right: 11,
    top: "50%",
    transform: "translateY(-50%)",
    color: "#777",
    pointerEvents: "none",
    fontSize: 11,
  },

  centerPreview: {
    marginTop: 12,
    padding: "11px 12px",
    background: "#f8fafc",
    border: "1px solid #e5e7eb",
    borderRadius: 8,
  },

  centerPreviewTitle: {
    fontSize: 13,
    fontWeight: 700,
    color: "#1f2937",
    marginBottom: 8,
  },

  centerPreviewRow: {
    display: "flex",
    justifyContent: "space-between",
    gap: 10,
    fontSize: 11.5,
    color: "#6b7280",
    padding: "3px 0",
  },

  summaryRow: {
    display: "flex",
    justifyContent: "space-between",
    gap: 10,
    fontSize: 12,
    color: "#666",
  },

  panelError: {
    marginTop: 10,
    padding: "8px 10px",
    background: "#fee2e2",
    color: "#991b1b",
    borderRadius: 7,
    fontSize: 12,
  },

  roomWarning: {
    padding: "7px 9px",
    marginTop: 3,
    background: "#fff7ed",
    color: "#9a3412",
    borderRadius: 6,
    fontSize: 11.5,
  },

  roomPreview: {
    marginTop: 12,
    padding: "11px 12px",
    background: "#f8fafc",
    border: "1px solid #e5e7eb",
    borderRadius: 8,
  },

  roomPreviewTitle: {
    fontSize: 13,
    fontWeight: 700,
    color: "#1f2937",
    marginBottom: 7,
  },

  roomCoordinates: {
    marginTop: 5,
    paddingTop: 5,
    borderTop: "1px solid #e5e7eb",
    fontSize: 10.5,
    color: "#777",
    lineHeight: 1.4,
  },

  roomMapSummary: {
    display: "flex",
    justifyContent: "space-between",
    marginTop: 12,
    padding: "8px 10px",
    background: "#f9fafb",
    borderRadius: 7,
    fontSize: 12,
    color: "#666",
  },

  familyPanel: {
    position: "absolute",
    top: 16,
    right: 16,
    zIndex: 1000,
    width: 320,
    maxWidth: "calc(100% - 32px)",
    background: "white",
    padding: "14px 16px",
    borderRadius: 10,
    boxShadow: "0 4px 14px rgba(0,0,0,0.18)",
    boxSizing: "border-box",
  },

  familyPanelMobile: {
    top: "auto",
    bottom: 16,
    left: 12,
    right: 12,
    width: "auto",
    maxWidth: "none",
    maxHeight: "55vh",
    overflowY: "auto",
  },

  roomOccupancy: {
    display: "grid",
    gridTemplateColumns: "1fr 1fr",
    gap: 8,
    marginTop: 10,
  },

  roomOccupancyItem: {
    background: "#f8fafc",
    border: "1px solid #e5e7eb",
    borderRadius: 7,
    padding: "8px 10px",
  },

  roomOccupancyLabel: {
    display: "block",
    fontSize: 11.5,
    color: "#64748b",
  },

  roomOccupancyValue: {
    display: "block",
    fontSize: 18,
    color: "#0f172a",
  },

  familyList: {
    marginTop: 12,
    maxHeight: 260,
    overflowY: "auto",
    border: "1px solid #e5e7eb",
    borderRadius: 8,
  },

  familyItemReadonly: {
    display: "flex",
    alignItems: "flex-start",
    gap: 9,
    padding: "10px",
    borderBottom: "1px solid #eee",
  },

  familyReadonlyIcon: {
    width: 28,
    height: 28,
    flexShrink: 0,
    borderRadius: 6,
    background: "#eff6ff",
    color: "#2563eb",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    fontSize: 12,
  },

  familyName: {
    fontSize: 13,
    fontWeight: 600,
    color: "#222",
  },

  familyDetails: {
    marginTop: 2,
    fontSize: 11.5,
    color: "#777",
  },

  familyAddress: {
    marginTop: 3,
    fontSize: 11,
    color: "#9ca3af",
  },

  familyLoading: {
    marginTop: 12,
    fontSize: 12.5,
    color: "#666",
  },

  familyEmpty: {
    marginTop: 12,
    padding: "12px",
    textAlign: "center",
    fontSize: 12.5,
    color: "#777",
    background: "#f9fafb",
    borderRadius: 8,
  },

  familyError: {
    marginTop: 10,
    padding: "8px 10px",
    background: "#fee2e2",
    color: "#991b1b",
    borderRadius: 7,
    fontSize: 12,
  },

  familyActions: {
    display: "flex",
    gap: 8,
    marginTop: 12,
    flexWrap: "wrap",
  },
};

export default EvacuationCenterManager;
const BASE_URL = "http://127.0.0.1:5000";

function getToken() {
  return localStorage.getItem("evacway_token");
}

async function request(path, options = {}) {
  const headers = { ...(options.headers || {}) };
  const token = getToken();

  if (token) {
    headers["Authorization"] = `Bearer ${token}`;
  }

  if (!(options.body instanceof FormData) && options.body) {
    headers["Content-Type"] = "application/json";
  }

  const res = await fetch(`${BASE_URL}${path}`, {
    ...options,
    headers,
  });

  const data = await res.json().catch(() => ({}));

  if (!res.ok) {
    throw new Error(
      data.error || `Request failed (${res.status})`
    );
  }

  return data;
}


export const api = {

  // -------------------------------------------------------
  // AUTH
  // -------------------------------------------------------

  login: (email, password) =>
    request("/api/auth/login", {
      method: "POST",
      body: JSON.stringify({
        email,
        password,
      }),
    }),


  // -------------------------------------------------------
  // HAZARD ZONES
  // -------------------------------------------------------

  getHazardZones: () =>
    request("/api/hazard-zones"),


  // -------------------------------------------------------
  // ROADS
  // -------------------------------------------------------

  getRoadSegments: () =>
    request("/api/road-segments"),


  // -------------------------------------------------------
  // EVACUATION CENTERS
  // -------------------------------------------------------

  getEvacuationCenters: (includeInactive = false) =>
    request(
      `/api/evacuation-centers${
        includeInactive
          ? "?include_inactive=true"
          : ""
      }`
    ),

  createEvacuationCenter: (payload) =>
    request("/api/evacuation-centers", {
      method: "POST",
      body: JSON.stringify(payload),
    }),

  updateEvacuationCenter: (id, payload) =>
    request(`/api/evacuation-centers/${id}`, {
      method: "PUT",
      body: JSON.stringify(payload),
    }),

  toggleCenterActive: (id) =>
    request(
      `/api/evacuation-centers/${id}/toggle-active`,
      {
        method: "PATCH",
      }
    ),


  // -------------------------------------------------------
  // HAZARD REPORTS
  // -------------------------------------------------------

  submitHazardReport: (formData) =>
    request("/api/hazard-reports", {
      method: "POST",
      body: formData,
    }),

  getHazardReports: (status) =>
    request(
      `/api/hazard-reports${
        status
          ? `?status=${status}`
          : ""
      }`
    ),

  validateHazardReport: (
    id,
    status,
    response_notes
  ) =>
    request(
      `/api/hazard-reports/${id}/validate`,
      {
        method: "PATCH",
        body: JSON.stringify({
          status,
          response_notes,
        }),
      }
    ),

  reopenRoad: (id) =>
    request(
      `/api/hazard-reports/${id}/reopen-road`,
      {
        method: "POST",
      }
    ),


  // -------------------------------------------------------
  // USERS
  // -------------------------------------------------------

  getUsers: () =>
    request("/api/users"),

  createUser: (payload) =>
    request("/api/users", {
      method: "POST",
      body: JSON.stringify(payload),
    }),

  toggleUserActive: (id) =>
    request(
      `/api/users/${id}/toggle-active`,
      {
        method: "PATCH",
      }
    ),

  resetUserPassword: (id) =>
    request(`/api/users/${id}/reset-password`, {
      method: "POST",
    }),

  resetPassword: (id) =>
    request(`/api/users/${id}/reset-password`, {
      method: "POST",
    }),

  getLogs: () =>
    request("/api/logs"),


  // -------------------------------------------------------
  // ROUTING
  // -------------------------------------------------------

  getEvacuationRoute: (lat, lng) =>
    request(
      `/api/evacuation-route?lat=${lat}&lng=${lng}`
    ),


  // -------------------------------------------------------
  // RESIDENTS
  // -------------------------------------------------------

  uploadResidents: (formData) =>
    request("/api/residents/upload", {
      method: "POST",
      body: formData,
    }),

  getResidents: (barangay) =>
    request(
      `/api/residents${
        barangay
          ? `?barangay=${encodeURIComponent(barangay)}`
          : ""
      }`
    ),

  findMyEvacuationCenter: (name) =>
    request(
      `/api/residents/find-center?name=${encodeURIComponent(name)}`
    ),

  // -------------------------------------------------------
  // ROOMS
  // -------------------------------------------------------

  addRoom: (centerId, data) =>
    request(
      `/api/evacuation-centers/${centerId}/rooms`,
      {
        method: "POST",
        body: JSON.stringify(data),
      }
    ),

  getRooms: (centerId) =>
    request(
      `/api/evacuation-centers/${centerId}/rooms`
    ),

  updateRoomLocation: (roomId, data) =>
    request(`/api/rooms/${roomId}/location`, {
      method: "PUT",
      body: JSON.stringify(data),
    }),

  getRoomFamilies: (roomId) =>
    request(
      `/api/rooms/${roomId}/families`
    ),

  getAvailableFamilies: (roomId) =>
    request(
      `/api/rooms/${roomId}/available-families`
    ),

  assignFamilies: (
    roomId,
    residentIds
  ) =>
    request(
      `/api/rooms/${roomId}/assign-families`,
      {
        method: "POST",
        body: JSON.stringify({
          resident_ids: residentIds,
        }),
      }
    ),


  // -------------------------------------------------------
  // BARANGAYS
  // -------------------------------------------------------

  getBarangays: () =>
    request("/api/barangays"),

  getBarangay: (id) =>
    request(`/api/barangays/${id}`),

  getBarangayEvacuationCenters: (barangayId) =>
    request(
      `/api/barangays/${barangayId}/evacuation-centers`
    ),

  // NEW: one family with its members (loaded when the modal opens)
  getFamily: (familyId) =>
    request(`/api/families/${familyId}`),
};


export { BASE_URL };
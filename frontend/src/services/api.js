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

async function requestFile(path) {
  const headers = {};
  const token = getToken();
  if (token) headers.Authorization = `Bearer ${token}`;
  const response = await fetch(`${BASE_URL}${path}`, { headers });
  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw new Error(data.error || `Request failed (${response.status})`);
  }
  return response.blob();
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

  requestPasswordReset: (email) =>
    request("/api/auth/password/forgot", {
      method: "POST",
      body: JSON.stringify({ email }),
    }),

  getNotifications: () => request("/api/notifications"),

  markNotificationRead: (id) =>
    request(`/api/notifications/${id}/read`, { method: "POST" }),

  getVapidPublicKey: () => request("/api/push/vapid-public-key"),

  savePushSubscription: (subscription) =>
    request("/api/push-subscriptions", {
      method: "POST",
      body: JSON.stringify(subscription),
    }),

  removePushSubscription: (endpoint) =>
    request("/api/push-subscriptions", {
      method: "DELETE",
      body: JSON.stringify({ endpoint }),
    }),

  submitRescueRequest: (payload) =>
    request("/api/rescue-requests", {
      method: "POST",
      body: JSON.stringify(payload),
    }),

  getRescueRequests: () => request("/api/rescue-requests"),

  updateRescueRequest: (id, status) =>
    request(`/api/rescue-requests/${id}`, {
      method: "PATCH",
      body: JSON.stringify({ status }),
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

  getEvacuationCenters: (filters = false) => {
    if (typeof filters === "boolean") {
      return request(
        `/api/evacuation-centers${filters ? "?include_inactive=true" : ""}`
      );
    }
    const params = new URLSearchParams();
    Object.entries(filters || {}).forEach(([key, val]) => {
      if (val !== undefined && val !== null && val !== "") {
        params.set(key, val);
      }
    });
    const query = params.toString();
    return request(`/api/evacuation-centers${query ? `?${query}` : ""}`);
  },

  getEvacuationCenter: (id) =>
    request(`/api/evacuation-centers/${id}`),

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

  deleteEvacuationCenter: (id) =>
    request(`/api/evacuation-centers/${id}`, {
      method: "DELETE",
    }),


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
    
  getPublicHazardReports: () =>
  request("/api/hazard-reports/public"),

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

  checkUserEmailAvailability: (email) =>
    request(`/api/users/check-email?email=${encodeURIComponent(email)}`),

  getMyProfile: () => request("/api/users/me"),

  updateMyProfile: (payload) =>
    request("/api/users/me", {
      method: "PATCH",
      body: JSON.stringify(payload),
    }),

  changeMyPassword: (currentPassword, newPassword) =>
    request("/api/users/me/password", {
      method: "POST",
      body: JSON.stringify({
        current_password: currentPassword,
        new_password: newPassword,
      }),
    }),

  requestMyPasswordReset: () =>
    request("/api/users/me/reset-password", { method: "POST" }),

  createUser: (payload) =>
    request("/api/users", {
      method: "POST",
      body: JSON.stringify(payload),
    }),

  updateUser: (id, payload) =>
    request(`/api/users/${id}`, {
      method: "PATCH",
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

  completePasswordSetup: (token, password) =>
    request("/api/auth/password/setup", {
      method: "POST",
      body: JSON.stringify({ token, password }),
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

  updateRoom: (roomId, data) =>
    request(`/api/rooms/${roomId}`, {
      method: "PUT",
      body: JSON.stringify(data),
    }),

  toggleRoomActive: (roomId) =>
    request(`/api/rooms/${roomId}/toggle-active`, {
      method: "PATCH",
    }),

  deleteRoom: (roomId) =>
    request(`/api/rooms/${roomId}`, {
      method: "DELETE",
    }),

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
    familyIds
  ) =>
    request(
      `/api/rooms/${roomId}/assign-families`,
      {
        method: "POST",
        body: JSON.stringify({
          family_ids: familyIds,
        }),
      }
    ),

  removeFamilyFromRoom: (roomId, familyOrResidentId) =>
    request(`/api/rooms/${roomId}/families/${familyOrResidentId}`, {
      method: "DELETE",
    }),


  // -------------------------------------------------------
  // BARANGAYS
  // -------------------------------------------------------

  getBarangays: () =>
    request("/api/barangays"),

  getBarangay: (id) =>
    request(`/api/barangays/${id}`),

  addBarangay: (payload) =>
    request("/api/barangays", {
      method: "POST",
      body: JSON.stringify(payload),
    }),

  updateBarangay: (id, payload) =>
    request(`/api/barangays/${id}`, {
      method: "PUT",
      body: JSON.stringify(payload),
    }),

  deleteBarangay: (id) =>
    request(`/api/barangays/${id}`, {
      method: "DELETE",
    }),

  getBarangayEvacuationCenters: (barangayId) =>
    request(
      `/api/barangays/${barangayId}/evacuation-centers`
    ),

  // Families
  getFamily: (familyId) =>
    request(`/api/families/${familyId}`),

  getFamilies: (filters = {}) => {
    const params = new URLSearchParams();
    Object.entries(filters).forEach(([key, value]) => {
      if (value !== undefined && value !== null && value !== "") params.set(key, value);
    });
    return request(`/api/families?${params.toString()}`);
  },

  addFamily: (payload) =>
    request("/api/families", {
      method: "POST",
      body: JSON.stringify(payload),
    }),

  updateFamily: (familyId, payload) =>
    request(`/api/families/${familyId}`, {
      method: "PUT",
      body: JSON.stringify(payload),
    }),

  deleteFamily: (familyId) =>
    request(`/api/families/${familyId}`, {
      method: "DELETE",
    }),

  addFamilyMember: (familyId, payload) =>
    request(`/api/families/${familyId}/members`, {
      method: "POST",
      body: JSON.stringify(payload),
    }),

  updateFamilyMember: (familyId, memberId, payload) =>
    request(`/api/families/${familyId}/members/${memberId}`, {
      method: "PUT",
      body: JSON.stringify(payload),
    }),

  deleteFamilyMember: (familyId, memberId) =>
    request(`/api/families/${familyId}/members/${memberId}`, {
      method: "DELETE",
    }),

  assignFamily: (familyId, payload) =>
    request(`/api/families/${familyId}/assign`, {
      method: "POST",
      body: JSON.stringify(payload),
    }),

  moveFamily: (familyId, payload) =>
    request(`/api/families/${familyId}/move`, {
      method: "POST",
      body: JSON.stringify(payload),
    }),

  unassignFamily: (familyId) =>
    request(`/api/families/${familyId}/unassign`, {
      method: "POST",
    }),

  previewFamilyImport: (file, commit = false) => {
    const formData = new FormData();
    formData.append("file", file);
    formData.append("commit", String(commit));
    return request("/api/families/import", {
      method: "POST",
      body: formData,
    });
  },

  downloadFamilyTemplate: () => requestFile("/api/families/template"),

  exportFamilies: (filters = {}) => {
    const params = new URLSearchParams();
    Object.entries(filters).forEach(([key, value]) => {
      if (value !== undefined && value !== null && value !== "") params.set(key, value);
    });
    return requestFile(`/api/families/export?${params.toString()}`);
  },
};


export { BASE_URL };
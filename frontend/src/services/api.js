const BASE_URL = import.meta.env.VITE_API_URL || "http://127.0.0.1:5000";

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

  submitResidentRegistration: (payload) =>
    request("/api/resident-registrations", {
      method: "POST",
      body: JSON.stringify(payload),
    }),

  getResidentRegistrations: ({ status = "pending", search = "" } = {}) => {
    const params = new URLSearchParams({ status });
    if (search.trim()) params.set("search", search.trim());
    return request(`/api/resident-registrations?${params.toString()}`);
  },

  getResidentRegistrationMatches: (requestId) =>
    request(`/api/resident-registrations/${requestId}/matches`),

  approveResidentRegistration: (requestId, matchedResidentId) =>
    request(`/api/resident-registrations/${requestId}/approve`, {
      method: "POST",
      body: JSON.stringify({ matched_resident_id: matchedResidentId }),
    }),

  rejectResidentRegistration: (requestId, reason) =>
    request(`/api/resident-registrations/${requestId}/reject`, {
      method: "POST",
      body: JSON.stringify({ reason }),
    }),

  resendResidentRegistrationEmail: (requestId) =>
    request(`/api/resident-registrations/${requestId}/resend-email`, {
      method: "POST",
    }),

    createResidentAccount: (payload) =>

    request("/api/resident-registrations/manual-create", {

      method: "POST",

      body: JSON.stringify(payload),

    }),



  requestPasswordReset: (email) =>
    request("/api/auth/password/forgot", {
      method: "POST",
      body: JSON.stringify({ email }),
    }),

  getNotifications: () => request("/api/notifications"),

  markNotificationRead: (id) =>
    request(`/api/notifications/${id}/read`, { method: "POST" }),

  clearNotificationsByResource: (resourceType, resourceId) =>
    request("/api/notifications/clear-resource", {
      method: "POST",
      body: JSON.stringify({
        resource_type: resourceType,
        resource_id: resourceId,
      }),
    }),

  clearAllNotifications: () =>
    request("/api/notifications", { method: "DELETE" }),

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
      body: payload,
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

  snapCoordinate: (lat, lng) =>
    request(`/api/routing/snap?lat=${encodeURIComponent(lat)}&lng=${encodeURIComponent(lng)}`),


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

  getAllowedCenterTypes: (centerId) =>
    request(`/api/evacuation-centers/${centerId}/allowed-center-types`),

  downloadCenterTemplate: () => requestFile("/api/evacuation-centers/template"),

  uploadCenters: (file) => {
    const formData = new FormData();
    formData.append("file", file);
    return request("/api/evacuation-centers/upload", {
      method: "POST",
      body: formData,
    });
  },

  exportCenters: () => requestFile("/api/evacuation-centers/export"),

  getCheckInList: (params = {}) => {
    const searchParams = new URLSearchParams();
    Object.entries(params).forEach(([key, val]) => {
      if (val !== undefined && val !== null && val !== "") {
        searchParams.set(key, val);
      }
    });
    const qs = searchParams.toString();
    return request(`/api/evacuation-centers/check-in-list${qs ? `?${qs}` : ""}`);
  },

  exportCheckInReport: (params = {}) => {
    const searchParams = new URLSearchParams();
    Object.entries(params).forEach(([key, val]) => {
      if (val !== undefined && val !== null && val !== "") {
        searchParams.set(key, val);
      }
    });
    const qs = searchParams.toString();
    return requestFile(`/api/evacuation-centers/check-in/report${qs ? `?${qs}` : ""}`);
  },

  getEvacuationSchedule: (centerId) => {
    const qs = centerId && centerId !== "all" ? `?center_id=${centerId}` : "";
    return request(`/api/evacuation-centers/schedule${qs}`);
  },

  updateEvacuationSchedule: (payload) =>
    request("/api/evacuation-centers/schedule", {
      method: "POST",
      body: JSON.stringify(payload),
    }),

  extendEvacuationSchedule: (payload) =>
    request("/api/evacuation-centers/schedule/extend", {
      method: "POST",
      body: JSON.stringify(payload),
    }),

  getEvacuationOperations: () => request("/api/evacuation-operations"),

  updateEvacueeCheckIn: (centerId, data) =>
    request(`/api/evacuation-centers/${centerId}/check-in`, {
      method: "POST",
      body: JSON.stringify(data),
    }),

  autoGeofenceCheckIn: (data) =>
    request("/api/evacuation-centers/check-in/auto", {
      method: "POST",
      body: JSON.stringify(data),
    }),

  patch: (path, body) =>
    request(path.startsWith("/api") ? path : `/api${path}`, {
      method: "PATCH",
      body: JSON.stringify(body),
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

  getEvacuationRoute: (lat, lng, centerId = null) =>
    request(
      `/api/evacuation-route?lat=${lat}&lng=${lng}${
        centerId != null ? `&center_id=${centerId}` : ""
      }`
    ),

  getProblemEntrances: () => request("/api/routing/problem-entrances"),


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

  getPublicBarangays: () => request("/api/barangays/public"),

  findMyEvacuationCenter: (param) => {
    if (typeof param === "object" && param !== null) {
      const cleanParams = {};
      Object.entries(param).forEach(([k, v]) => {
        if (v !== undefined && v !== null && v !== "") cleanParams[k] = v;
      });
      const q = new URLSearchParams(cleanParams).toString();
      return request(`/api/residents/find-center?${q}`);
    }
    if (typeof param === "number") {
      return request(`/api/residents/find-center?resident_id=${param}`);
    }
    return request(
      `/api/residents/find-center?name=${encodeURIComponent(param || "")}`
    );
  },

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

  unlinkRoomFromBuilding: (roomId) =>
    request(`/api/rooms/${roomId}/unlink-building`, {
      method: "POST",
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

  getAvailableFamilies: (roomId, centerId) => {
    if (roomId && roomId !== "all") {
      return request(`/api/rooms/${roomId}/available-families`);
    }
    if (centerId) {
      return request(`/api/evacuation-centers/${centerId}/available-families`);
    }
    return Promise.resolve([]);
  },

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

  // Stage an import: validates the file but saves nothing to live data.
  // Returns a staging token that must be presented at commit time.
  stageFamilyImport: (file) => {
    const formData = new FormData();
    formData.append("file", file);
    return request("/api/families/import/stage", {
      method: "POST",
      body: formData,
    });
  },

  // Commit a staged import: requires a valid, unexpired staging token.
  // All records are saved in a single transaction or none are.
  commitFamilyImport: (stagingToken) => {
    return request("/api/families/import/commit", {
      method: "POST",
      body: JSON.stringify({ staging_token: stagingToken }),
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

  getRosterYears: () => request("/api/roster-years"),

  // -------------------------------------------------------
  // BUILDINGS & ROOM MAPPING
  // -------------------------------------------------------

  getCenterBuildings: (centerId) =>
    request(`/api/evacuation-centers/${centerId}/buildings`),

  createBuilding: (centerId, data) =>
    request(`/api/evacuation-centers/${centerId}/buildings`, {
      method: "POST",
      body: JSON.stringify(data),
    }),

  updateBuilding: (buildingId, data) =>
    request(`/api/buildings/${buildingId}`, {
      method: "PUT",
      body: JSON.stringify(data),
    }),

  deleteBuilding: (buildingId) =>
    request(`/api/buildings/${buildingId}`, {
      method: "DELETE",
    }),

  getBuildingDetails: (buildingId, params = {}) => {
    const searchParams = new URLSearchParams();
    Object.entries(params).forEach(([key, val]) => {
      if (val !== undefined && val !== null && val !== "") {
        searchParams.set(key, val);
      }
    });
    const qs = searchParams.toString();
    return request(`/api/buildings/${buildingId}/details${qs ? `?${qs}` : ""}`);
  },

  // -------------------------------------------------------
  // AUTOSUGGEST
  // -------------------------------------------------------

  autosuggestResidents: (query, signal) =>
    request(`/api/residents/autosuggest?q=${encodeURIComponent(query)}`, {
      signal,
    }),

  // -------------------------------------------------------
  // SHELTER METADATA: CENTER TYPES, MATERIALS, AMENITIES
  // -------------------------------------------------------

  // Center Types
  getCenterTypes: (params = {}) => {
    const qs = new URLSearchParams(params).toString();
    return request(`/api/center-types${qs ? `?${qs}` : ""}`);
  },
  createCenterType: (data) =>
    request("/api/center-types", {
      method: "POST",
      body: JSON.stringify(data),
    }),
  updateCenterType: (id, data) =>
    request(`/api/center-types/${id}`, {
      method: "PUT",
      body: JSON.stringify(data),
    }),
  deleteCenterType: (id) =>
    request(`/api/center-types/${id}`, {
      method: "DELETE",
    }),

  // Building Materials
  getBuildingMaterials: (params = {}) => {
    const qs = new URLSearchParams(params).toString();
    return request(`/api/building-materials${qs ? `?${qs}` : ""}`);
  },
  createBuildingMaterial: (data) =>
    request("/api/building-materials", {
      method: "POST",
      body: JSON.stringify(data),
    }),
  updateBuildingMaterial: (id, data) =>
    request(`/api/building-materials/${id}`, {
      method: "PUT",
      body: JSON.stringify(data),
    }),
  deleteBuildingMaterial: (id) =>
    request(`/api/building-materials/${id}`, {
      method: "DELETE",
    }),

  // Amenities
  getAmenities: (params = {}) => {
    const qs = new URLSearchParams(params).toString();
    return request(`/api/amenities${qs ? `?${qs}` : ""}`);
  },
  createAmenity: (data) =>
    request("/api/amenities", {
      method: "POST",
      body: JSON.stringify(data),
    }),
  updateAmenity: (id, data) =>
    request(`/api/amenities/${id}`, {
      method: "PUT",
      body: JSON.stringify(data),
    }),
  deleteAmenity: (id) =>
    request(`/api/amenities/${id}`, {
      method: "DELETE",
    }),

  // Aliases for accessibility features
  getAccessibilityFeatures: (params) => {
    const qs = new URLSearchParams(params || {}).toString();
    return request(`/api/amenities${qs ? `?${qs}` : ""}`);
  },
  createAccessibilityFeature: (data) =>
    request("/api/amenities", {
      method: "POST",
      body: JSON.stringify(data),
    }),
  updateAccessibilityFeature: (id, data) =>
    request(`/api/amenities/${id}`, {
      method: "PUT",
      body: JSON.stringify(data),
    }),
  deleteAccessibilityFeature: (id) =>
    request(`/api/amenities/${id}`, {
      method: "DELETE",
    }),
};


export { BASE_URL };
export default api;
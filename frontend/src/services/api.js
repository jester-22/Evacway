const BASE_URL = import.meta.env.VITE_API_URL ?? "";

function buildRequestUrl(path) {
  const base = BASE_URL.replace(/\/+$/, "");
  const requestPath = path.startsWith("/") ? path : `/${path}`;

  // API paths already include /api. Avoid duplicating it when the configured
  // base URL is the same-origin /api proxy used by Docker and Vite.
  if (base.endsWith("/api") && requestPath.startsWith("/api/")) {
    return `${base}${requestPath.slice(4)}`;
  }

  return `${base}${requestPath}`;
}

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

  let res;
  try {
    res = await fetch(buildRequestUrl(path), {
      ...options,
      headers,
    });
  } catch (networkError) {
    throw new Error("Couldn't reach the server. Check your connection and try again.");
  }

  const data = await res.json().catch(() => ({}));

  if (!res.ok) {
    if (
      res.status === 401 &&
      token &&
      !String(path || "").startsWith("/api/auth/")
    ) {
      window.dispatchEvent(new CustomEvent("evacway:auth-expired"));
    }
    const err = new Error(
      data.error || data.message || `Request failed (${res.status})`
    );
    err.status = res.status;
    err.data = data;
    throw err;
  }

  return data;
}

async function requestFile(path) {
  const headers = {};
  const token = getToken();
  if (token) headers.Authorization = `Bearer ${token}`;
  let response;
  try {
    response = await fetch(buildRequestUrl(path), { headers });
  } catch (networkError) {
    throw new Error("Couldn't reach the server. Check your connection and try again.");
  }
  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw new Error(data.error || data.message || `Request failed (${response.status})`);
  }
  return response.blob();
}

function roomCapacityPayload(data = {}) {
  const { capacity: legacyCapacity, ...roomData } = data || {};
  return {
    ...roomData,
    family_slots: Number(roomData.family_slots ?? 5),
    people_spaces: Number(roomData.people_spaces ?? legacyCapacity ?? 25),
  };
}


export const api = {
  getPublicOfflineCenters: async () => {
    let response;
    try {
      response = await fetch(buildRequestUrl("/api/public/offline-centers"), {
        method: "GET",
        credentials: "omit",
        headers: { Accept: "application/json" },
      });
    } catch {
      throw new Error("Couldn't reach the server. Check your connection and try again.");
    }
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(data.error || data.message || `Request failed (${response.status})`);
    }
    return data;
  },

  getNonRegisteredEvacuees: (params = {}) => request(`/api/non-registered-evacuees?${new URLSearchParams(params)}`),
  getNonRegisteredGroup: (code, sensitive = false) => request(`/api/non-registered-evacuees/groups/${code}?include_sensitive=${sensitive}`),
  createNonRegisteredGroup: (payload) => request('/api/non-registered-evacuees', { method: 'POST', body: JSON.stringify(payload) }),
  updateNonRegisteredPerson: (id, payload) => request(`/api/non-registered-evacuees/${id}`, { method: 'PATCH', body: JSON.stringify(payload) }),
  addNonRegisteredMember: (code, payload) => request(`/api/non-registered-evacuees/groups/${code}/members`, { method: 'POST', body: JSON.stringify(payload) }),
  departNonRegistered: (id, departed, group = false) => request(group ? `/api/non-registered-evacuees/groups/${id}/departure` : `/api/non-registered-evacuees/${id}/departure`, { method: 'POST', body: JSON.stringify({ departed }) }),
  deleteNonRegisteredPerson: (id) => request(`/api/non-registered-evacuees/${id}`, { method: 'DELETE' }),
  findNonRegisteredDuplicates: (q, operationId) => request(`/api/non-registered-evacuees/duplicates?${new URLSearchParams({ q, operation_id: operationId })}`),

  // -------------------------------------------------------
  // AUTH
  // -------------------------------------------------------

  staffLogin: (email, password) =>
    request("/api/auth/login", {
      method: "POST",
      body: JSON.stringify({
        email,
        password,
      }),
    }),

  confirmStaffTotpEnrollment: (setupToken, code) =>
    request("/api/auth/staff/totp/enroll/confirm", {
      method: "POST",
      body: JSON.stringify({ setup_token: setupToken, code }),
    }),
  verifyStaffTotp: (challengeToken, code) =>
    request("/api/auth/staff/totp/verify", {
      method: "POST",
      body: JSON.stringify({ challenge_token: challengeToken, code }),
    }),
  sendStaffEmailOtp: (flowToken) =>
    request("/api/auth/staff/mfa/email/send", {
      method: "POST",
      body: JSON.stringify({ challenge_token: flowToken }),
    }),
  verifyStaffEmailOtp: (emailOtpToken, code) =>
    request("/api/auth/staff/mfa/email/verify", {
      method: "POST",
      body: JSON.stringify({ email_otp_token: emailOtpToken, code }),
    }),
  requestStaffTotpRecovery: (challengeToken) =>
    request("/api/auth/staff/totp/recovery", {
      method: "POST",
      body: JSON.stringify({ challenge_token: challengeToken }),
    }),
  getAdminMfaRecoveryRequests: () => request("/api/admin/mfa-recovery-requests"),
  approveAdminMfaRecoveryRequest: (id) =>
    request(`/api/admin/mfa-recovery-requests/${id}/approve`, { method: "POST" }),

  residentLogin: (email, password) =>
    request("/api/auth/resident-login", {
      method: "POST",
      body: JSON.stringify({ email, password }),
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

  updateResidentRegistration: (requestId, payload) =>
    request(`/api/resident-registrations/${requestId}`, {
      method: "PATCH",
      body: JSON.stringify(payload),
    }),

  approveResidentRegistration: (requestId, matchedResidentId, overrideReason = "") => {
    const payload = { matched_resident_id: matchedResidentId };
    if (overrideReason && overrideReason.trim()) {
      payload.override_reason = overrideReason.trim();
    }
    return request(`/api/resident-registrations/${requestId}/approve`, {
      method: "POST",
      body: JSON.stringify(payload),
    });
  },

  rejectResidentRegistration: (requestId, reason) =>
    request(`/api/resident-registrations/${requestId}/reject`, {
      method: "POST",
      body: JSON.stringify({ reason }),
    }),

  unlinkResidentRegistration: (requestId) =>
    request(`/api/resident-registrations/${requestId}/unlink`, {
      method: "POST",
    }),

  resendResidentRegistrationEmail: (requestId) =>
    request(`/api/resident-registrations/${requestId}/resend-email`, {
      method: "POST",
    }),

  sendResidentResetPasswordEmail: (requestId) =>
    request(`/api/resident-registrations/${requestId}/reset-password`, {
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

  getRescueRequestFormContext: () => request("/api/rescue-requests/form-context"),

  getRescueRequests: () => request("/api/rescue-requests"),

  updateRescueRequest: (id, payloadOrStatus) => {
    const body =
      typeof payloadOrStatus === "string"
        ? { status: payloadOrStatus }
        : payloadOrStatus || {};
    return request(`/api/rescue-requests/${id}`, {
      method: "PATCH",
      body: JSON.stringify(body),
    });
  },


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

  getPublicStatusSummary: () =>
    request("/api/public-status-summary"),

  getPublicOperationAlert: () =>
    request("/api/public-operation-alert"),

  getDashboardSummary: () =>
    request("/api/dashboard/summary"),

  snapCoordinate: (lat, lng, { snapToIntersection = true } = {}) =>
    request(`/api/routing/snap?lat=${encodeURIComponent(lat)}&lng=${encodeURIComponent(lng)}&snap_intersection=${snapToIntersection}`),


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
      `/api/hazard-reports${status
        ? `?status=${status}`
        : ""
      }`
    ),

  getPublicHazardReports: () =>
    request("/api/hazard-reports/public"),

  validateHazardReport: (
    id,
    status,
    response_notes,
    rejection_reason,
    duplicate_of
  ) => {
    const payload = {
      status,
      response_notes,
    };
    if (rejection_reason !== undefined) {
      payload.rejection_reason = rejection_reason;
    }
    if (duplicate_of !== undefined) {
      payload.duplicate_of = duplicate_of;
    }
    return request(
      `/api/hazard-reports/${id}/validate`,
      {
        method: "PATCH",
        body: JSON.stringify(payload),
      }
    );
  },

  setHazardReportDuplicate: (id, duplicate_of) =>
    request(
      `/api/hazard-reports/${id}/duplicate`,
      {
        method: "PATCH",
        body: JSON.stringify({ duplicate_of }),
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

  getEvacuationRoute: (lat, lng, centerId = null, heading = null) =>
    request(
      `/api/evacuation-route?lat=${lat}&lng=${lng}${centerId != null ? `&center_id=${centerId}` : ""
      }${heading != null && Number.isFinite(Number(heading)) ? `&heading=${encodeURIComponent(Number(heading))}` : ""}`
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
      `/api/residents${barangay
        ? `?barangay=${encodeURIComponent(barangay)}`
        : ""
      }`
    ),

  getPublicBarangays: () => request("/api/barangays/public"),

  lookupMyEvacuationCenter: (payload) =>
    request("/api/residents/my-center-lookup", {
      method: "POST",
      body: JSON.stringify(payload),
    }),

  getMyEvacuationCenter: () => request("/api/residents/my-center"),

  findSomeoneCenter: (fullName, barangayId, additionalDetail = "") =>
    request("/api/residents/find-center", {
      method: "POST",
      body: JSON.stringify({
        full_name: fullName,
        barangay_id: barangayId,
        additional_detail: additionalDetail,
      }),
    }),

  getFindSomeonePrivacy: () => request("/api/residents/profile/find-someone"),

  updateFindSomeonePrivacy: (searchable) =>
    request("/api/residents/profile/find-someone", {
      method: "PATCH",
      body: JSON.stringify({ searchable }),
    }),

  // -------------------------------------------------------
  // ROOMS
  // -------------------------------------------------------

  addRoom: (centerId, data) =>
    request(
      `/api/evacuation-centers/${centerId}/rooms`,
      {
        method: "POST",
        body: JSON.stringify(roomCapacityPayload(data)),
      }
    ),

  getRooms: (centerId) =>
    request(
      `/api/evacuation-centers/${centerId}/rooms`
    ),

  updateRoom: (roomId, data) =>
    request(`/api/rooms/${roomId}`, {
      method: "PUT",
      body: JSON.stringify(roomCapacityPayload(data)),
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
  stageFamilyImport: (file, barangayId) => {
    const formData = new FormData();
    formData.append("file", file);
    if (barangayId !== undefined && barangayId !== null && barangayId !== "") {
      formData.append("barangay_id", String(barangayId));
    }
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

  downloadFamilyTemplate: (barangayId) => {
    const query =
      barangayId !== undefined && barangayId !== null && barangayId !== ""
        ? `?barangay_id=${encodeURIComponent(barangayId)}`
        : "";
    return requestFile(`/api/families/template${query}`);
  },

  exportFamilies: (filters = {}) => {
    const params = new URLSearchParams();
    Object.entries(filters).forEach(([key, value]) => {
      if (value !== undefined && value !== null && value !== "") params.set(key, value);
    });
    return requestFile(`/api/families/export?${params.toString()}`);
  },

  getRosterYears: () => request("/api/roster-years"),

  carryOverRosterYear: (sourceYear, payload = {}) =>
    request(`/api/roster-years/${sourceYear}/carry-over`, {
      method: "POST",
      body: JSON.stringify(payload),
    }),

  // -------------------------------------------------------
  // BUILDINGS & ROOM MAPPING
  // -------------------------------------------------------

  getCenterBuildings: (centerId) =>
    request(`/api/evacuation-centers/${centerId}/buildings`),

  suggestRoomsForBuildings: (centerId) =>
    request(`/api/evacuation-centers/${centerId}/suggest-rooms`),

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

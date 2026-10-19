import { useMemo } from "react";
import { keepPreviousData, useQueries, useQuery } from "@tanstack/react-query";
import { api } from "../services/api";

function normalizeKeyId(id) {
  if (id === undefined || id === null || id === "") return null;
  const num = Number(id);
  return Number.isNaN(num) ? id : num;
}

export const queryKeys = {
  activeCenters: ["evacuation-centers", "active"],
  allCenters: ["evacuation-centers", "all"],
  rooms: (centerId) => ["rooms", normalizeKeyId(centerId)],
  roomFamilies: (roomId) => ["room-families", normalizeKeyId(roomId)],
  barangays: ["barangays"],
  barangay: (barangayId) => ["barangays", "detail", normalizeKeyId(barangayId)],
  barangayCenters: (barangayId) => ["barangay-centers", normalizeKeyId(barangayId)],
  families: (filters) => ["families", "list", filters],
  family: (familyId) => ["families", "detail", normalizeKeyId(familyId)],
  residents: (barangayIdOrName) => ["residents", "barangay", barangayIdOrName],
  logs: ["logs"],
  hazardReports: (status) => ["hazard-reports", "list", status || "all"],
  hazardZones: ["hazard-zones"],
  roadSegments: ["road-segments"],
  publicHazardReports: ["hazard-reports", "public"],
  sogodBoundary: ["sogod-boundary"],
  dashboardFamilies: ["families", "dashboard"],
  users: ["users"],
  notifications: ["notifications"],
  rescueRequests: ["rescue-requests"],
};

export async function invalidateEvacuationQueries(queryClient) {
  await Promise.all([
    queryClient.invalidateQueries({ queryKey: ["barangays"] }),
    queryClient.invalidateQueries({ queryKey: ["barangay-centers"] }),
    queryClient.invalidateQueries({ queryKey: ["families"] }),
    queryClient.invalidateQueries({ queryKey: ["residents"] }),
    queryClient.invalidateQueries({ queryKey: ["evacuation-centers"] }),
    queryClient.invalidateQueries({ queryKey: ["rooms"] }),
    queryClient.invalidateQueries({ queryKey: ["room-families"] }),
  ]);
}

function normalizeRooms(response, centerId) {
  const rooms = Array.isArray(response)
    ? response
    : Array.isArray(response?.rooms)
      ? response.rooms
      : Array.isArray(response?.data)
        ? response.data
        : [];

  return rooms.map((room) => ({
    ...room,
    evacuation_center_id: room.evacuation_center_id ?? centerId,
  }));
}

export async function fetchRooms(centerId) {
  return normalizeRooms(await api.getRooms(centerId), centerId);
}

function combineRoomQueries(queries) {
  return {
    roomData: queries.map((query) => query.data || []),
    isLoading: queries.some((query) => query.isLoading),
    isFetching: queries.some((query) => query.isFetching),
    error: queries.find((query) => query.error)?.error || null,
    refetch: () => Promise.all(queries.map((query) => query.refetch())),
  };
}

export function useEvacuationCenters(includeInactive = false, options = {}) {
  return useQuery({
    queryKey: includeInactive ? queryKeys.allCenters : queryKeys.activeCenters,
    queryFn: () => api.getEvacuationCenters(includeInactive),
    ...options,
  });
}

export function useRooms(centerId, options = {}) {
  return useQuery({
    queryKey: queryKeys.rooms(centerId),
    queryFn: () => fetchRooms(centerId),
    enabled: centerId != null,
    ...options,
  });
}

export function useRoomsForCenters(centers, options = {}) {
  const uniqueCenters = useMemo(() => {
    const centerList = Array.isArray(centers) ? centers : centers?.features || [];
    const centersById = new Map();

    centerList.forEach((center) => {
      const properties = center.properties || center;
      const centerId = properties.id ?? properties.center_id ?? center.id;
      if (centerId != null && !centersById.has(centerId)) {
        centersById.set(centerId, { center, centerId });
      }
    });

    return Array.from(centersById.values());
  }, [centers]);

  const roomQueries = useQueries({
    queries: uniqueCenters.map(({ centerId }) => ({
      queryKey: queryKeys.rooms(centerId),
      queryFn: () => fetchRooms(centerId),
      ...options,
    })),
    combine: combineRoomQueries,
  });

  const results = useMemo(
    () => uniqueCenters.map(({ center, centerId }, index) => ({
      center,
      centerId,
      rooms: roomQueries.roomData[index] || [],
    })),
    [uniqueCenters, roomQueries.roomData]
  );
  const rooms = useMemo(() => results.flatMap((result) => result.rooms), [results]);

  return {
    results,
    rooms,
    isLoading: roomQueries.isLoading,
    isFetching: roomQueries.isFetching,
    error: roomQueries.error,
    refetch: roomQueries.refetch,
  };
}

export function useBarangays(options = {}) {
  return useQuery({
    queryKey: queryKeys.barangays,
    queryFn: api.getBarangays,
    ...options,
  });
}

export function useHazardZones(options = {}) {
  return useQuery({
    queryKey: queryKeys.hazardZones,
    queryFn: api.getHazardZones,
    ...options,
  });
}

export function useRoadSegments(options = {}) {
  return useQuery({
    queryKey: queryKeys.roadSegments,
    queryFn: api.getRoadSegments,
    ...options,
  });
}

export function usePublicHazardReports(options = {}) {
  return useQuery({
    queryKey: queryKeys.publicHazardReports,
    queryFn: api.getPublicHazardReports,
    ...options,
  });
}

export function useSogodBoundary(options = {}) {
  return useQuery({
    queryKey: queryKeys.sogodBoundary,
    queryFn: async () => {
      const response = await fetch("/sogod_boundary.geojson");
      if (!response.ok) throw new Error("Failed to load Sogod boundary.");
      return response.json();
    },
    ...options,
  });
}

export function useRoomFamilies(roomId, options = {}) {
  return useQuery({
    queryKey: queryKeys.roomFamilies(roomId),
    queryFn: () => api.getRoomFamilies(roomId),
    enabled: roomId != null,
    ...options,
  });
}

export function useDashboardSummary(isAdmin) {
  const refreshOptions = {
    refetchInterval: 30000,
    refetchIntervalInBackground: false,
  };
  const barangaysQuery = useBarangays(refreshOptions);
  const familiesQuery = useQuery({
    queryKey: queryKeys.dashboardFamilies,
    queryFn: () => api.getFamilies({ all: "true" }),
    ...refreshOptions,
  });
  const centersQuery = useEvacuationCenters(false, refreshOptions);
  const roomsQuery = useRoomsForCenters(centersQuery.data, refreshOptions);
  const usersQuery = useQuery({
    queryKey: queryKeys.users,
    queryFn: api.getUsers,
    enabled: isAdmin,
    ...refreshOptions,
  });

  const barangays = Array.isArray(barangaysQuery.data) ? barangaysQuery.data : [];
  const centersById = new Map();
  (centersQuery.data?.features || []).forEach((feature) => {
    const props = feature?.properties || feature || {};
    const centerId = props.id ?? props.center_id ?? feature?.id;
    if (props.is_active !== false && centerId != null && !centersById.has(String(centerId))) {
      centersById.set(String(centerId), feature);
    }
  });
  const centers = Array.from(centersById.values());
  const seenRoomIds = new Set();
  const centerRooms = roomsQuery.results.map(({ center, rooms }) => {
    const properties = center.properties || center;
    const uniqueRooms = rooms.filter((room) => {
      if (room.id == null) return false;
      if (room.is_active === false) return false;
      const roomId = String(room.id);
      if (seenRoomIds.has(roomId)) return false;
      seenRoomIds.add(roomId);
      return true;
    });
    const occupied = uniqueRooms.filter((room) =>
      Boolean(
        room.is_assigned ||
        room.assignment_status === "Assigned" ||
        Number(room.occupied) > 0
      )
    ).length;
    const capacity = uniqueRooms.reduce((sum, room) => sum + Number(room.capacity || 0), 0);
    const assignedPeople = uniqueRooms.reduce((sum, room) => sum + Number(room.occupied || 0), 0);

    return {
      id: properties.id ?? properties.center_id ?? center.id,
      name: properties.name || "Unnamed center",
      barangays: properties.barangays || [],
      barangay: (properties.barangays || []).map((barangay) => barangay.name).filter(Boolean).join(", ")
        || "Barangay not specified",
      total: uniqueRooms.length,
      occupied,
      assignedRooms: occupied,
      unassignedRooms: Math.max(0, uniqueRooms.length - occupied),
      available: uniqueRooms.length - occupied,
      capacity,
      assignedPeople,
      remainingCapacity: Math.max(0, capacity - assignedPeople),
    };
  }).sort((first, second) =>
    second.available - first.available
    || second.total - first.total
    || first.name.localeCompare(second.name)
    || first.barangay.localeCompare(second.barangay)
    || String(first.id).localeCompare(String(second.id))
  );
  const totalRooms = centerRooms.reduce((total, center) => total + center.total, 0);
  const occupiedRooms = centerRooms.reduce((total, center) => total + center.occupied, 0);
  const staff = isAdmin ? usersQuery.data || [] : [];
  const errors = [
    barangaysQuery.error,
    familiesQuery.error,
    centersQuery.error,
    roomsQuery.error,
    usersQuery.error,
  ];
  const isLoading = barangaysQuery.isLoading
    || familiesQuery.isLoading
    || centersQuery.isLoading
    || roomsQuery.isLoading
    || (isAdmin && usersQuery.isLoading);

  const totalHouseholds = Number(
    familiesQuery.data?.household_count ?? familiesQuery.data?.total ?? 0
  );
  const totalResidents = Number(familiesQuery.data?.resident_count ?? 0);
  const assignedFamilies = Number(familiesQuery.data?.assigned_family_count ?? 0);
  const unassignedFamilies = Number(
    familiesQuery.data?.unassigned_family_count ?? Math.max(0, totalHouseholds - assignedFamilies)
  );

  return {
    stats: familiesQuery.data && centersQuery.data && !isLoading
      ? {
          barangays: barangays.length,
          families: totalHouseholds,
          assignedFamilies,
          unassignedFamilies,
          residents: totalResidents,
          centers: centers.length,
          totalCapacity: centerRooms.reduce((total, center) => total + center.capacity, 0),
          totalAssignedPeople: centerRooms.reduce((total, center) => total + center.assignedPeople, 0),
          totalRooms,
          assignedRooms: occupiedRooms,
          unassignedRooms: Math.max(0, totalRooms - occupiedRooms),
          occupiedRooms,
          availableRooms: Math.max(0, totalRooms - occupiedRooms),
          centerRooms,
          totalStaff: staff.filter((account) => account.role === "lgu_personnel").length,
          activeStaff: staff.filter((account) => account.role === "lgu_personnel" && account.is_active).length,
        }
      : null,
    isLoading,
    isFetching: barangaysQuery.isFetching
      || familiesQuery.isFetching
      || centersQuery.isFetching
      || roomsQuery.isFetching
      || (isAdmin && usersQuery.isFetching),
    error: errors.find(Boolean) || null,
    refetch: async () => {
      await Promise.all([
        barangaysQuery.refetch(),
        familiesQuery.refetch(),
        centersQuery.refetch(),
        roomsQuery.refetch(),
        isAdmin ? usersQuery.refetch() : Promise.resolve(),
      ]);
    },
  };
}

export function useBarangay(barangayId, options = {}) {
  return useQuery({
    queryKey: queryKeys.barangay(barangayId),
    queryFn: () => api.getBarangay(barangayId),
    enabled: barangayId != null,
    ...options,
  });
}

export function useBarangayCenters(barangayId, options = {}) {
  return useQuery({
    queryKey: queryKeys.barangayCenters(barangayId),
    queryFn: () => api.getBarangayEvacuationCenters(barangayId),
    enabled: barangayId != null,
    ...options,
  });
}

export function useFamilies(filters = {}, options = {}) {
  return useQuery({
    queryKey: queryKeys.families(filters),
    queryFn: () => api.getFamilies(filters),
    placeholderData: keepPreviousData,
    ...options,
  });
}

export function useFamily(familyId, options = {}) {
  return useQuery({
    queryKey: queryKeys.family(familyId),
    queryFn: () => api.getFamily(familyId),
    enabled: familyId != null,
    ...options,
  });
}

export function useUsers(options = {}) {
  return useQuery({
    queryKey: queryKeys.users,
    queryFn: api.getUsers,
    ...options,
  });
}

export function useLogs(options = {}) {
  return useQuery({
    queryKey: queryKeys.logs,
    queryFn: api.getLogs,
    ...options,
  });
}

export function useHazardReports(status, options = {}) {
  return useQuery({
    queryKey: queryKeys.hazardReports(status),
    queryFn: () => api.getHazardReports(status === "all" ? null : status),
    ...options,
  });
}

export function useNotifications(options = {}) {
  return useQuery({
    queryKey: queryKeys.notifications,
    queryFn: api.getNotifications,
    refetchInterval: 30000,
    refetchIntervalInBackground: false,
    ...options,
  });
}

export function useRescueRequests(options = {}) {
  return useQuery({
    queryKey: queryKeys.rescueRequests,
    queryFn: api.getRescueRequests,
    refetchInterval: 30000,
    refetchIntervalInBackground: false,
    ...options,
  });
}
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
  evacuationCenters: (includeInactive = false) =>
    includeInactive ? ["evacuation-centers", "all"] : ["evacuation-centers", "active"],
  rooms: (centerId) => ["rooms", normalizeKeyId(centerId)],
  buildings: (centerId) => ["buildings", normalizeKeyId(centerId)],
  buildingDetails: (buildingId) => ["building-details", normalizeKeyId(buildingId)],
  centerDetails: (centerId) => ["evacuation-center-details", normalizeKeyId(centerId)],
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
  publicStatusSummary: ["public-status-summary"],
  publicOperationAlert: ["public-operation-alert"],
  sogodBoundary: ["sogod-boundary"],
  dashboardSummary: ["dashboard", "summary"],
  dashboardFamilies: ["families", "dashboard"],
  checkInSummary: ["evacuee-check-in-list", "summary"],
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
    queryClient.invalidateQueries({ queryKey: ["evacuation-center-details"] }),
    queryClient.invalidateQueries({ queryKey: ["rooms"] }),
    queryClient.invalidateQueries({ queryKey: ["buildings"] }),
    queryClient.invalidateQueries({ queryKey: ["building-details"] }),
    queryClient.invalidateQueries({ queryKey: ["room-families"] }),
    queryClient.invalidateQueries({ queryKey: ["dashboard"] }),
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

export function usePublicOfflineCenters(options = {}) {
  return useQuery({
    queryKey: ["public-offline-centers"],
    queryFn: api.getPublicOfflineCenters,
    staleTime: 0,
    gcTime: 60 * 60 * 1000,
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

export function usePublicStatusSummary(options = {}) {
  return useQuery({
    queryKey: queryKeys.publicStatusSummary,
    queryFn: api.getPublicStatusSummary,
    staleTime: 60_000,
    gcTime: 60_000,
    refetchInterval: 60_000,
    ...options,
  });
}

export function usePublicOperationAlert(options = {}) {
  return useQuery({
    queryKey: queryKeys.publicOperationAlert,
    queryFn: api.getPublicOperationAlert,
    staleTime: 60_000,
    gcTime: 60_000,
    refetchInterval: 60_000,
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

export function useCenterBuildings(centerId, options = {}) {
  return useQuery({
    queryKey: queryKeys.buildings(centerId),
    queryFn: () => api.getCenterBuildings(centerId),
    enabled: centerId != null,
    ...options,
  });
}

export function useBuildingDetails(buildingId, options = {}) {
  return useQuery({
    queryKey: queryKeys.buildingDetails(buildingId),
    queryFn: () => api.getBuildingDetails(buildingId),
    enabled: buildingId != null,
    ...options,
  });
}

export function useDashboardSummary(isAdmin) {
  const summaryQuery = useQuery({
    queryKey: [...queryKeys.dashboardSummary, Boolean(isAdmin)],
    queryFn: api.getDashboardSummary,
    staleTime: 60 * 1000,
    refetchInterval: 60 * 1000,
    refetchIntervalInBackground: false,
  });

  const payload = summaryQuery.data || null;
  const stats = payload?.stats || null;
  const barangays = Array.isArray(payload?.barangays) ? payload.barangays : [];
  const isLoading = summaryQuery.isLoading;

  return {
    stats,
    barangays,
    isLoading,
    loading: {
      families: isLoading,
      checkIn: isLoading,
      centers: isLoading,
      barangays: isLoading,
      users: Boolean(isAdmin) && isLoading,
    },
    isFetching: summaryQuery.isFetching,
    error: summaryQuery.error || null,
    refetch: async () => {
      await summaryQuery.refetch();
    },
  };
}

export function useCenterDetails(centerId, options = {}) {
  return useQuery({
    queryKey: queryKeys.centerDetails(centerId),
    queryFn: () => api.getEvacuationCenter(centerId),
    enabled: centerId != null,
    staleTime: 60 * 1000,
    ...options,
  });
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
    refetchInterval: 10000,
    refetchIntervalInBackground: true,
    refetchOnWindowFocus: true,
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

export function useBuildingsForCenters(centersData) {
  const centerIds = useMemo(() => {
    const features = Array.isArray(centersData?.features)
      ? centersData.features
      : Array.isArray(centersData)
        ? centersData
        : [];
    return features
      .map((f) => f.properties?.id ?? f.id)
      .filter((id) => id !== undefined && id !== null);
  }, [centersData]);

  const combined = useQueries({
    queries: centerIds.map((centerId) => ({
      queryKey: queryKeys.buildings(centerId),
      queryFn: () => api.getCenterBuildings(centerId),
      enabled: centerId !== null && centerId !== undefined,
      staleTime: 60 * 1000,
    })),
    combine: (results) => {
      const allFeatures = [];
      let isLoading = false;
      let isFetching = false;
      for (const q of results) {
        if (q.isLoading) isLoading = true;
        if (q.isFetching) isFetching = true;
        if (q.data && Array.isArray(q.data.features)) {
          allFeatures.push(...q.data.features);
        }
      }
      return {
        buildingsGeoJSON: {
          type: "FeatureCollection",
          features: allFeatures,
        },
        isLoading,
        isFetching,
        refetch: () => Promise.all(results.map((q) => q.refetch())),
      };
    },
  });

  return combined;
}

import {
  useEvacuationCenters,
  useRoomsForCenters,
  useBuildingsForCenters,
} from "./useEvacuationQueries";

export function useEvacuationData() {
  const centersQuery = useEvacuationCenters();
  const roomsQuery = useRoomsForCenters(centersQuery.data);
  const buildingsQuery = useBuildingsForCenters(centersQuery.data);

  return {
    evacCenters: centersQuery.data ?? null,
    rooms: roomsQuery.rooms,
    buildingsGeoJSON: buildingsQuery.buildingsGeoJSON,
    refetchBuildings: buildingsQuery.refetch,
    isLoading:
      centersQuery.isLoading ||
      roomsQuery.isLoading ||
      buildingsQuery.isLoading,
    isFetching:
      centersQuery.isFetching ||
      roomsQuery.isFetching ||
      buildingsQuery.isFetching,
  };
}

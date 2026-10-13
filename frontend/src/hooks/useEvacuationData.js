import { useEvacuationCenters, useRoomsForCenters } from "./useEvacuationQueries";

export function useEvacuationData() {
  const centersQuery = useEvacuationCenters();
  const roomsQuery = useRoomsForCenters(centersQuery.data);

  return {
    evacCenters: centersQuery.data ?? null,
    rooms: roomsQuery.rooms,
    isLoading: centersQuery.isLoading || roomsQuery.isLoading,
    isFetching: centersQuery.isFetching || roomsQuery.isFetching,
  };
}

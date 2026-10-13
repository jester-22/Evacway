import { useState } from "react";
import { useHazardZones } from "./useEvacuationQueries";

export function useHazardData(options = {}) {
  const hazardQuery = useHazardZones(options);
  const hazardZones = hazardQuery.data ?? null;
  const [visibleLayers, setVisibleLayers] = useState({
    flood: false,
    landslide: false,
  });

  const filteredHazardZones = hazardZones
    ? {
        ...hazardZones,
        features: hazardZones.features.filter(
          (feature) => visibleLayers[feature.properties?.hazard_type]
        ),
      }
    : null;

  return {
    hazardZones,
    visibleLayers,
    setVisibleLayers,
    filteredHazardZones,
    isLoading: hazardQuery.isLoading,
    isFetching: hazardQuery.isFetching,
  };
}

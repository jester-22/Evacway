import { useState, useEffect } from "react";
import { api } from "../services/api";

export function useHazardData() {
  const [hazardZones, setHazardZones] = useState(null);
  const [visibleLayers, setVisibleLayers] = useState({
    flood: false,
    landslide: false,
  });

  useEffect(() => {
    api.getHazardZones()
      .then(setHazardZones)
      .catch((err) => console.error("Failed to load hazard zones:", err));
  }, []);

  const refreshHazardZones = () => {
    api.getHazardZones()
      .then(setHazardZones)
      .catch((err) => console.error("Failed to refresh hazard zones:", err));
  };

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
    refreshHazardZones,
    filteredHazardZones,
  };
}

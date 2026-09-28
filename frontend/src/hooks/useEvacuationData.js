import { useState, useEffect } from "react";
import { api } from "../services/api";

export function useEvacuationData() {
  const [evacCenters, setEvacCenters] = useState(null);
  const [rooms, setRooms] = useState([]);

  useEffect(() => {
    api.getEvacuationCenters()
      .then(setEvacCenters)
      .catch((err) => console.error("Failed to load evacuation centers:", err));
  }, []);

  useEffect(() => {
    if (!evacCenters?.features?.length) {
      setRooms([]);
      return;
    }

    let cancelled = false;

    async function loadRooms() {
      const results = await Promise.all(
        evacCenters.features.map(async (center) => {
          const centerId = center.properties?.id;
          if (centerId == null) return [];
          try {
            const response = await api.getRooms(centerId);
            const centerRooms = Array.isArray(response)
              ? response
              : Array.isArray(response?.rooms)
              ? response.rooms
              : Array.isArray(response?.data)
              ? response.data
              : [];
            return centerRooms.map((room) => ({
              ...room,
              evacuation_center_id: room.evacuation_center_id ?? centerId,
            }));
          } catch (err) {
            console.warn(`Could not load rooms for center ${centerId}:`, err);
            return [];
          }
        })
      );

      if (!cancelled) {
        setRooms(results.flat());
      }
    }

    loadRooms();
    return () => { cancelled = true; };
  }, [evacCenters]);

  return { evacCenters, rooms };
}

import { useState } from "react";
import { api } from "../services/api";

export function useRouting() {
  const [route, setRoute] = useState(null);
  const [routeIsMine, setRouteIsMine] = useState(false);
  const [routeError, setRouteError] = useState("");
  const [findingRoute, setFindingRoute] = useState(false);

  async function findRoute(lat, lng) {
    setFindingRoute(true);
    setRouteError("");
    try {
      const result = await api.getEvacuationRoute(lat, lng);
      setRoute(result);
      setRouteIsMine(false);
    } catch (err) {
      setRouteError(err.message || "Failed to find route");
    } finally {
      setFindingRoute(false);
    }
  }

  return {
    route,
    setRoute,
    routeIsMine,
    setRouteIsMine,
    routeError,
    setRouteError,
    findingRoute,
    setFindingRoute,
    findRoute,
  };
}

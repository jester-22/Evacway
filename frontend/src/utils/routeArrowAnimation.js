export const ROUTE_ARROW_ANIMATION_INTERVAL_MS = 100;

export function shouldUpdateRouteArrowAnimation(now, lastUpdate) {
  return lastUpdate == null || now - lastUpdate >= ROUTE_ARROW_ANIMATION_INTERVAL_MS;
}

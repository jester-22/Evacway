import { useState, useEffect } from "react";

const MOBILE_BREAKPOINT = 1024;

/**
 * Tracks whether the viewport is below the mobile breakpoint.
 * Default breakpoint: 1024px (matches dashboard mobile drawer threshold).
 */
export function useIsMobile(breakpoint = MOBILE_BREAKPOINT) {
  const [isMobile, setIsMobile] = useState(
    typeof window !== "undefined" ? window.innerWidth < breakpoint : false
  );

  useEffect(() => {
    function handleResize() {
      setIsMobile(window.innerWidth < breakpoint);
    }

    window.addEventListener("resize", handleResize);
    return () => {
      window.removeEventListener("resize", handleResize);
    };
  }, [breakpoint]);

  return isMobile;
}

export { MOBILE_BREAKPOINT };
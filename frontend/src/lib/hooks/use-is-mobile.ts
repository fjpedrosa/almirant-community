"use client";

import { useSyncExternalStore } from "react";

/**
 * Hook to detect if the current viewport is mobile-sized.
 * Uses the `md` breakpoint (768px) as the threshold.
 *
 * Uses `useSyncExternalStore` for optimal React 18+ compatibility
 * and to avoid hydration mismatches.
 *
 * @returns {boolean} true if viewport width is less than 768px
 *
 * @example
 * ```tsx
 * const isMobile = useIsMobile();
 *
 * return (
 *   <div className={isMobile ? "flex-col" : "flex-row"}>
 *     {isMobile ? <MobileNav /> : <DesktopNav />}
 *   </div>
 * );
 * ```
 */

const MOBILE_QUERY = "(max-width: 767px)";

function getMobileSnapshot(): boolean {
  if (typeof window === "undefined") {
    return false;
  }
  return window.matchMedia(MOBILE_QUERY).matches;
}

function getServerSnapshot(): boolean {
  return false;
}

function subscribeToMobile(callback: () => void): () => void {
  const mql = window.matchMedia(MOBILE_QUERY);
  mql.addEventListener("change", callback);
  return () => mql.removeEventListener("change", callback);
}

export const useIsMobile = (): boolean => {
  return useSyncExternalStore(
    subscribeToMobile,
    getMobileSnapshot,
    getServerSnapshot
  );
};

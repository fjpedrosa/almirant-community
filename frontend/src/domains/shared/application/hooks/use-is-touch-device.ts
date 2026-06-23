"use client";

import { useSyncExternalStore } from "react";

/**
 * Media query to detect touch-only devices
 * (hover: none) = device cannot hover (touch primary)
 * (pointer: coarse) = coarse pointer like finger
 * Combined with AND for more accuracy on hybrid devices
 */
const TOUCH_MEDIA_QUERY = "(hover: none) and (pointer: coarse)";

/**
 * Subscribe to media query changes
 */
function subscribeToMediaQuery(callback: () => void): () => void {
  if (typeof window === "undefined") {
    return () => {};
  }

  const mediaQuery = window.matchMedia(TOUCH_MEDIA_QUERY);
  mediaQuery.addEventListener("change", callback);

  return () => {
    mediaQuery.removeEventListener("change", callback);
  };
}

/**
 * Get the current value of the media query
 */
function getSnapshot(): boolean {
  if (typeof window === "undefined") {
    return false;
  }
  return window.matchMedia(TOUCH_MEDIA_QUERY).matches;
}

/**
 * Server snapshot - always returns false to avoid hydration mismatch
 * Desktop is the more common case, so defaulting to false is reasonable
 */
function getServerSnapshot(): boolean {
  return false;
}

/**
 * Hook to detect if the current device is touch-only (no hover capability)
 *
 * Uses useSyncExternalStore for SSR compatibility - no hydration mismatch.
 * On the server and during initial hydration, returns false (desktop mode).
 * After hydration, reflects the actual device capability.
 *
 * For most UI cases, prefer using the CSS utility `.touch-visible` in globals.css
 * which handles touch/desktop visibility purely in CSS without any JS.
 *
 * Use this hook when you need conditional JS logic based on touch capability,
 * such as implementing long-press handlers or touch-specific gestures.
 *
 * @example
 * ```tsx
 * function ActionButton() {
 *   const { isTouchDevice } = useIsTouchDevice();
 *
 *   // Use CSS utility for visibility (preferred)
 *   // Use hook for JS-only behavior
 *   const handleInteraction = isTouchDevice
 *     ? handleLongPress
 *     : handleClick;
 *
 *   return <button onPointerDown={handleInteraction}>Action</button>;
 * }
 * ```
 */
export function useIsTouchDevice(): { isTouchDevice: boolean } {
  const isTouchDevice = useSyncExternalStore(
    subscribeToMediaQuery,
    getSnapshot,
    getServerSnapshot
  );

  return { isTouchDevice };
}

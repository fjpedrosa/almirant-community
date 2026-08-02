"use client";

import { startTransition, useCallback, useEffect, useState } from "react";

interface UseSuppressAnalysisPollingReturn {
  suppressed: boolean;
  suppress: () => void;
  clear: () => void;
}

/**
 * Defensive client-side flag that disables analysis polling when we know
 * there is no real job behind `debugAnalysisStatus="queued"`.
 *
 * The current backend/client flow clears those fields when no job is created,
 * but we keep this hook to shield the panel from legacy/stale cache states.
 *
 * The `resetKey` (typically `selectedItemId`) resets the flag when the user
 * opens a different feedback item — each panel session starts with polling
 * enabled.
 *
 * Design: a plain boolean, not a bundleId comparison. The "no real job" state
 * is a property of the panel's lifecycle, not the specific bundle. Comparing
 * bundleIds would add complexity without benefit and risks TDZ issues.
 */
export const useSuppressAnalysisPolling = (
  resetKey: string | null,
): UseSuppressAnalysisPollingReturn => {
  const [suppressed, setSuppressed] = useState(false);

  useEffect(() => {
    startTransition(() => setSuppressed(false));
  }, [resetKey]);

  const suppress = useCallback(() => setSuppressed(true), []);
  const clear = useCallback(() => setSuppressed(false), []);

  return { suppressed, suppress, clear };
};

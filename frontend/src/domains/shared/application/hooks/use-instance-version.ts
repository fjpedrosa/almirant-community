"use client";

import { useCallback, useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { instanceVersionApi } from "@/lib/api/client";
import type { InstanceVersionInfo } from "../../domain/instance-version-types";

const DISMISS_KEY_PREFIX = "almirant:update-dismissed:";

const dismissKeyFor = (latest: string | null): string =>
  `${DISMISS_KEY_PREFIX}${latest ?? "unknown"}`;

const readDismissed = (latest: string | null): boolean => {
  if (typeof window === "undefined" || !latest) return false;
  try {
    return window.localStorage.getItem(dismissKeyFor(latest)) === "1";
  } catch {
    return false;
  }
};

const writeDismissed = (latest: string | null): void => {
  if (typeof window === "undefined" || !latest) return;
  try {
    window.localStorage.setItem(dismissKeyFor(latest), "1");
  } catch {
    // localStorage unavailable (private mode, storage full) — ignore
  }
};

export interface UseInstanceVersionResult {
  info: InstanceVersionInfo | undefined;
  isLoading: boolean;
  /** True when there's an update AND the user hasn't dismissed this exact SHA. */
  shouldShowBanner: boolean;
  dismiss: () => void;
}

export const useInstanceVersion = (): UseInstanceVersionResult => {
  const { data, isLoading } = useQuery<InstanceVersionInfo>({
    queryKey: ["instance", "version"],
    queryFn: () => instanceVersionApi.get(),
    // Cache matches backend TTL — no point polling more often than the
    // backend is willing to re-check GitHub.
    staleTime: 30 * 60 * 1000,
    gcTime: 60 * 60 * 1000,
    refetchOnWindowFocus: false,
    // If the admin check fails (403 for non-admins), don't retry — treat it
    // as "no info" and just hide the banner.
    retry: false,
  });

  const [dismissedVersion, setDismissedVersion] = useState<string | null>(null);

  // Re-read localStorage whenever `latest` changes (e.g. after a fresh poll).
  useEffect(() => {
    if (data?.latest && readDismissed(data.latest)) {
      setDismissedVersion(data.latest);
    }
  }, [data?.latest]);

  const dismiss = useCallback(() => {
    if (!data?.latest) return;
    writeDismissed(data.latest);
    setDismissedVersion(data.latest);
  }, [data?.latest]);

  const shouldShowBanner = Boolean(
    data?.updateAvailable &&
      data.latest &&
      dismissedVersion !== data.latest,
  );

  return {
    info: data,
    isLoading,
    shouldShowBanner,
    dismiss,
  };
};

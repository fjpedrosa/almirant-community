"use client";

import { useQuery } from "@tanstack/react-query";
import { vercelApi } from "@/lib/api/client";
import type { VercelConnectionStatus } from "../../domain/types";

export const vercelKeys = {
  all: ["vercel"] as const,
  status: () => [...vercelKeys.all, "status"] as const,
  projects: () => [...vercelKeys.all, "projects"] as const,
};

export const useVercelStatus = () => {
  return useQuery({
    queryKey: vercelKeys.status(),
    queryFn: () =>
      vercelApi.getStatus() as Promise<VercelConnectionStatus>,
    // No refetchOnWindowFocus override: the connection status rarely changes, so
    // it inherits the global `false` instead of re-fetching on every tab focus.
    staleTime: 60_000,
  });
};

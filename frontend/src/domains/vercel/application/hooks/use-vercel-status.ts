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
    staleTime: 60_000,
    refetchOnWindowFocus: true,
  });
};

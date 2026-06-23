"use client";

import { useCallback, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { projectsApi } from "@/lib/api/client";
import { projectKeys } from "./use-projects";
import type { ProjectWithRelations } from "../../domain/types";

/**
 * Returns a debounced handler that prefetches a project's detail data on hover.
 * Uses a 150ms debounce to avoid firing on quick mouse passes.
 *
 * React Query's `prefetchQuery` is a no-op when data is already cached and fresh,
 * so hovering over the same card multiple times will not trigger duplicate requests.
 */
export const usePrefetchProjectDetail = () => {
  const queryClient = useQueryClient();
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const prefetchProject = useCallback(
    (projectId: string) => {
      // Clear any pending debounce
      if (timerRef.current) {
        clearTimeout(timerRef.current);
      }

      timerRef.current = setTimeout(() => {
        queryClient.prefetchQuery({
          queryKey: projectKeys.detail(projectId),
          queryFn: () => projectsApi.get(projectId) as Promise<ProjectWithRelations>,
          staleTime: 30_000,
        });
      }, 150);
    },
    [queryClient]
  );

  const cancelPrefetch = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  return { prefetchProject, cancelPrefetch };
};

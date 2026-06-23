"use client";

import { useState, useCallback, useMemo } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { projectsApi } from "@/lib/api/client";
import { projectKeys } from "./use-projects";
import { buildProjectScreenshotImageUrl } from "./project-screenshot-url";

export const useProjectScreenshot = (
  projectId: string,
  storedScreenshotUrl: string | null,
  productionUrl: string | null
) => {
  const queryClient = useQueryClient();
  // Track which URL failed to load, rather than a simple boolean.
  // When the screenshotUrl changes (e.g. after a React Query refetch),
  // the derived `imageError` automatically becomes false because the
  // new URL won't match the failed one.
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);

  const screenshotUrl = useMemo(() => {
    return buildProjectScreenshotImageUrl(projectId, storedScreenshotUrl);
  }, [projectId, storedScreenshotUrl]);

  const imageError = screenshotUrl !== null && screenshotUrl === failedUrl;

  const hostname = useMemo(() => {
    if (!productionUrl) return null;
    try {
      return new URL(productionUrl).hostname;
    } catch {
      return productionUrl;
    }
  }, [productionUrl]);

  const handleImageError = useCallback(() => {
    setFailedUrl(screenshotUrl);
  }, [screenshotUrl]);

  const handleVisitSite = useCallback(() => {
    if (productionUrl) {
      window.open(productionUrl, "_blank", "noopener,noreferrer");
    }
  }, [productionUrl]);

  const handleRefreshScreenshot = useCallback(async () => {
    if (!projectId || isRefreshing) return;
    setIsRefreshing(true);
    setFailedUrl(null);
    try {
      await projectsApi.captureScreenshot(projectId);
      // The backend captures the screenshot asynchronously (fire-and-forget).
      // Poll the project detail until the screenshotUrl changes, or timeout.
      const startTime = Date.now();
      const maxWait = 30_000;
      const pollInterval = 3_000;

      const poll = async () => {
        while (Date.now() - startTime < maxWait) {
          await new Promise((resolve) => setTimeout(resolve, pollInterval));
          // Invalidate the React Query cache so the project data is refetched
          await queryClient.invalidateQueries({
            queryKey: projectKeys.detailBatch(projectId),
          });
          // Check if the screenshot URL has changed
          const freshData = queryClient.getQueryData<{
            project?: { screenshotUrl?: string | null };
          }>(projectKeys.detailBatch(projectId));
          const freshUrl = freshData?.project?.screenshotUrl ?? null;
          if (freshUrl && freshUrl !== storedScreenshotUrl) {
            // New screenshot available
            break;
          }
        }
        setIsRefreshing(false);
      };

      poll();
    } catch {
      setIsRefreshing(false);
    }
  }, [projectId, isRefreshing, storedScreenshotUrl, queryClient]);

  return {
    screenshotUrl,
    hostname,
    imageError,
    handleImageError,
    handleVisitSite,
    handleRefreshScreenshot,
    isRefreshing,
    hasUrl: !!productionUrl,
  };
};

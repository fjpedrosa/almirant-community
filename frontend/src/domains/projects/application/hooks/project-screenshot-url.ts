import { API_BASE, buildApiRequestUrl } from "@/lib/api/client";

export const buildProjectScreenshotImageUrl = (
  projectId: string,
  storedScreenshotUrl: string | null,
): string | null => {
  if (!storedScreenshotUrl) return null;

  const cacheVersion = encodeURIComponent(storedScreenshotUrl);
  return buildApiRequestUrl(
    API_BASE,
    `/projects/${projectId}/screenshot?v=${cacheVersion}`,
  );
};

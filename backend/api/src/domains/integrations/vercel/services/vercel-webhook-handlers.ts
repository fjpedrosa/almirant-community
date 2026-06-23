import { logger } from "@almirant/config";
import { db, eq, getProjects, workItems, sql } from "@almirant/database";
import { captureAndStoreScreenshot } from "../../../../shared/services/screenshot-service";

const normalizeUrl = (url: string): string => {
  return url
    .replace(/^https?:\/\//, "")
    .replace(/\/+$/, "")
    .toLowerCase();
};

const findProjectByDeploymentUrl = async (
  deploymentUrls: string[]
) => {
  // Fetch all projects (with a high limit) to compare URLs
  const { projects } = await getProjects(
    { page: 1, limit: 1000, offset: 0 },
    {}
  );

  const normalizedDeploymentUrls = deploymentUrls.map(normalizeUrl);

  return projects.find((project) => {
    if (!project.productionUrl) return false;
    const normalizedProjectUrl = normalizeUrl(project.productionUrl);
    return normalizedDeploymentUrls.some(
      (deployUrl) => deployUrl === normalizedProjectUrl
    );
  });
};

export const handleDeploymentSucceeded = async (
  payload: Record<string, unknown>
): Promise<void> => {
  try {
    const deployment = payload.payload as Record<string, unknown> | undefined;
    if (!deployment) {
      logger.warn("Vercel webhook: no payload.payload found");
      return;
    }

    const urls: string[] = [];

    const deploymentUrl = deployment.url as string | undefined;
    if (deploymentUrl) {
      urls.push(deploymentUrl);
    }

    const aliases = deployment.alias as string[] | undefined;
    if (Array.isArray(aliases)) {
      urls.push(...aliases);
    }

    if (urls.length === 0) {
      logger.info("Vercel webhook: no deployment URLs found in payload");
      return;
    }

    logger.info({ urls }, "Vercel deployment succeeded, looking for matching project");

    const project = await findProjectByDeploymentUrl(urls);

    if (!project) {
      logger.info({ urls }, "No project found matching deployment URLs");
      return;
    }

    logger.info(
      { projectId: project.id, productionUrl: project.productionUrl },
      "Found matching project, capturing screenshot"
    );

    // Fire-and-forget
    captureAndStoreScreenshot(project.id, project.productionUrl!).catch((e) =>
      logger.error(e, "Screenshot capture failed after Vercel deploy")
    );

    // Store preview URL on work items linked to the deployment branch
    storePreviewUrlOnWorkItems(deployment).catch((e) =>
      logger.error(e, "Failed to store preview URL on work items")
    );
  } catch (error) {
    logger.error(
      { error: error instanceof Error ? error.message : String(error) },
      "Error handling Vercel deployment.succeeded webhook"
    );
  }
};

/**
 * When a Vercel preview deployment succeeds, find work items that have a PR
 * linked to the same branch and store the preview URL in their metadata.
 */
const storePreviewUrlOnWorkItems = async (
  deployment: Record<string, unknown>
): Promise<void> => {
  const target = deployment.target as string | undefined;

  // Only process preview deployments (not production)
  if (target !== "preview") {
    return;
  }

  const meta = deployment.meta as Record<string, unknown> | undefined;
  const branch = meta?.githubCommitRef as string | undefined;

  if (!branch) {
    logger.info("Vercel preview deployment has no githubCommitRef, skipping preview URL update");
    return;
  }

  const deploymentUrl = deployment.url as string | undefined;
  if (!deploymentUrl) {
    logger.info("Vercel preview deployment has no URL, skipping preview URL update");
    return;
  }

  const previewUrl = `https://${deploymentUrl}`;

  // Find work items whose metadata.pullRequest.branch matches this deployment branch.
  // Uses JSONB operators to query the nested field.
  const matchingItems = await db
    .select({ id: workItems.id, metadata: workItems.metadata })
    .from(workItems)
    .where(
      sql`${workItems.metadata}->'pullRequest'->>'branch' = ${branch}`
    );

  if (matchingItems.length === 0) {
    logger.info({ branch }, "No work items found with PR branch matching deployment");
    return;
  }

  logger.info(
    { branch, previewUrl, workItemCount: matchingItems.length },
    "Storing Vercel preview URL on matching work items"
  );

  // Update each matching work item's metadata with the preview URL
  for (const item of matchingItems) {
    const currentMetadata = (item.metadata as Record<string, unknown>) ?? {};
    const updatedMetadata = { ...currentMetadata, previewUrl };

    await db
      .update(workItems)
      .set({ metadata: updatedMetadata, updatedAt: new Date() })
      .where(eq(workItems.id, item.id));
  }
};

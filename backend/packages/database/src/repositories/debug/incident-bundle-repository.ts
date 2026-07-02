import { db } from "../../client";
import { incidentBundles } from "../../schema";
import { eq, and, desc } from "drizzle-orm";
import type { IncidentBundle, NewIncidentBundle, IncidentBundleData } from "../../schema";

const NULL_UUID = "00000000-0000-0000-0000-000000000000";

/**
 * Create an incident bundle. workspaceId is mandatory — never null, never the nil UUID.
 * Throws if the caller attempts to create an ownerless bundle.
 */
export const createIncidentBundle = async (
  data: Omit<NewIncidentBundle, "id" | "createdAt" | "updatedAt"> & { workspaceId: string }
): Promise<IncidentBundle> => {
  if (!data.workspaceId || data.workspaceId === NULL_UUID) {
    throw new Error("createIncidentBundle: workspaceId is required and must not be the nil UUID");
  }
  const [bundle] = await db.insert(incidentBundles).values(data).returning();
  if (!bundle) throw new Error("Failed to create incident bundle");
  return bundle;
};

/**
 * Retrieve a bundle by ID, scoped to the caller's workspace.
 * Returns null if the bundle does not exist OR belongs to a different org.
 */
export const getIncidentBundleForWorkspace = async (
  workspaceId: string,
  bundleId: string
): Promise<IncidentBundle | null> => {
  const [bundle] = await db
    .select()
    .from(incidentBundles)
    .where(
      and(
        eq(incidentBundles.id, bundleId),
        eq(incidentBundles.workspaceId, workspaceId)
      )
    )
    .limit(1);
  return bundle ?? null;
};

/**
 * Update a bundle's data payload, scoped to the caller's workspace.
 * Returns null if the bundle does not exist OR belongs to a different org.
 */
export const updateIncidentBundleDataForWorkspace = async (
  workspaceId: string,
  bundleId: string,
  data: IncidentBundleData
): Promise<IncidentBundle | null> => {
  const [updated] = await db
    .update(incidentBundles)
    .set({ data, updatedAt: new Date() })
    .where(
      and(
        eq(incidentBundles.id, bundleId),
        eq(incidentBundles.workspaceId, workspaceId)
      )
    )
    .returning();
  return updated ?? null;
};

/**
 * List bundles for a feedback item, scoped to the caller's workspace.
 * Ordered newest-first.
 */
export const listBundlesForFeedbackItemInWorkspace = async (
  workspaceId: string,
  feedbackItemId: string
): Promise<IncidentBundle[]> => {
  return db
    .select()
    .from(incidentBundles)
    .where(
      and(
        eq(incidentBundles.feedbackItemId, feedbackItemId),
        eq(incidentBundles.workspaceId, workspaceId)
      )
    )
    .orderBy(desc(incidentBundles.createdAt));
};

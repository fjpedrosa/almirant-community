import { db } from "../../client";
import { incidentBundles } from "../../schema";
import { eq, and, desc } from "drizzle-orm";
import type { IncidentBundle, NewIncidentBundle, IncidentBundleData } from "../../schema";

const NULL_UUID = "00000000-0000-0000-0000-000000000000";

/**
 * Create an incident bundle. organizationId is mandatory — never null, never the nil UUID.
 * Throws if the caller attempts to create an ownerless bundle.
 */
export const createIncidentBundle = async (
  data: Omit<NewIncidentBundle, "id" | "createdAt" | "updatedAt"> & { organizationId: string }
): Promise<IncidentBundle> => {
  if (!data.organizationId || data.organizationId === NULL_UUID) {
    throw new Error("createIncidentBundle: organizationId is required and must not be the nil UUID");
  }
  const [bundle] = await db.insert(incidentBundles).values(data).returning();
  if (!bundle) throw new Error("Failed to create incident bundle");
  return bundle;
};

/**
 * Retrieve a bundle by ID, scoped to the caller's organization.
 * Returns null if the bundle does not exist OR belongs to a different org.
 */
export const getIncidentBundleForOrganization = async (
  organizationId: string,
  bundleId: string
): Promise<IncidentBundle | null> => {
  const [bundle] = await db
    .select()
    .from(incidentBundles)
    .where(
      and(
        eq(incidentBundles.id, bundleId),
        eq(incidentBundles.organizationId, organizationId)
      )
    )
    .limit(1);
  return bundle ?? null;
};

/**
 * Update a bundle's data payload, scoped to the caller's organization.
 * Returns null if the bundle does not exist OR belongs to a different org.
 */
export const updateIncidentBundleDataForOrganization = async (
  organizationId: string,
  bundleId: string,
  data: IncidentBundleData
): Promise<IncidentBundle | null> => {
  const [updated] = await db
    .update(incidentBundles)
    .set({ data, updatedAt: new Date() })
    .where(
      and(
        eq(incidentBundles.id, bundleId),
        eq(incidentBundles.organizationId, organizationId)
      )
    )
    .returning();
  return updated ?? null;
};

/**
 * List bundles for a feedback item, scoped to the caller's organization.
 * Ordered newest-first.
 */
export const listBundlesForFeedbackItemInOrganization = async (
  organizationId: string,
  feedbackItemId: string
): Promise<IncidentBundle[]> => {
  return db
    .select()
    .from(incidentBundles)
    .where(
      and(
        eq(incidentBundles.feedbackItemId, feedbackItemId),
        eq(incidentBundles.organizationId, organizationId)
      )
    )
    .orderBy(desc(incidentBundles.createdAt));
};

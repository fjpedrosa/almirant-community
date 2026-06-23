import { db } from "../../client";
import { projectDocLinks, projects } from "../../schema";
import { eq, and } from "drizzle-orm";
import type {
  ProjectDocLink,
  CreateDocLinkRequest,
  UpdateDocLinkRequest,
} from "../../domain/types";

// Verify project belongs to organization
const verifyProjectOrg = async (
  organizationId: string,
  projectId: string
): Promise<boolean> => {
  const [proj] = await db
    .select({ id: projects.id })
    .from(projects)
    .where(and(eq(projects.id, projectId), eq(projects.organizationId, organizationId)))
    .limit(1);
  return !!proj;
};

// Get all doc links for a project
export const getDocLinks = async (
  organizationId: string,
  projectId: string
): Promise<ProjectDocLink[]> => {
  if (!(await verifyProjectOrg(organizationId, projectId))) return [];

  const result = await db
    .select()
    .from(projectDocLinks)
    .where(eq(projectDocLinks.projectId, projectId))
    .orderBy(projectDocLinks.order);

  return result as ProjectDocLink[];
};

// Create a doc link
export const createDocLink = async (
  organizationId: string,
  projectId: string,
  data: CreateDocLinkRequest
): Promise<ProjectDocLink> => {
  if (!(await verifyProjectOrg(organizationId, projectId))) {
    throw new Error("Project not found or does not belong to organization");
  }

  const [newLink] = await db
    .insert(projectDocLinks)
    .values({
      projectId,
      title: data.title,
      url: data.url,
      type: data.type || "other",
      order: data.order ?? 0,
    })
    .returning();

  return newLink as ProjectDocLink;
};

// Update a doc link
export const updateDocLink = async (
  organizationId: string,
  id: string
, data: UpdateDocLinkRequest
): Promise<ProjectDocLink | null> => {
  // Verify doc link belongs to org via project
  const [existing] = await db
    .select({ id: projectDocLinks.id, projectId: projectDocLinks.projectId })
    .from(projectDocLinks)
    .innerJoin(projects, eq(projectDocLinks.projectId, projects.id))
    .where(and(eq(projectDocLinks.id, id), eq(projects.organizationId, organizationId)))
    .limit(1);
  if (!existing) return null;

  const [updated] = await db
    .update(projectDocLinks)
    .set({
      ...data,
      updatedAt: new Date(),
    })
    .where(eq(projectDocLinks.id, id))
    .returning();

  if (!updated) return null;

  return updated as ProjectDocLink;
};

// Delete a doc link
export const deleteDocLink = async (
  organizationId: string,
  id: string
): Promise<boolean> => {
  // Verify doc link belongs to org via project
  const [existing] = await db
    .select({ id: projectDocLinks.id })
    .from(projectDocLinks)
    .innerJoin(projects, eq(projectDocLinks.projectId, projects.id))
    .where(and(eq(projectDocLinks.id, id), eq(projects.organizationId, organizationId)))
    .limit(1);
  if (!existing) return false;

  const result = await db
    .delete(projectDocLinks)
    .where(eq(projectDocLinks.id, id))
    .returning();
  return result.length > 0;
};

// Reorder doc links for a project
export const reorderDocLinks = async (
  organizationId: string,
  projectId: string,
  linkIds: string[]
): Promise<void> => {
  if (!(await verifyProjectOrg(organizationId, projectId))) return;

  await Promise.all(
    linkIds.map((linkId, index) =>
      db
        .update(projectDocLinks)
        .set({ order: index, updatedAt: new Date() })
        .where(
          and(
            eq(projectDocLinks.id, linkId),
            eq(projectDocLinks.projectId, projectId)
          )
        )
    )
  );
};

import { db } from "../../client";
import { projectRepositories, projects } from "../../schema";
import { eq, and } from "drizzle-orm";
import type {
  ProjectRepository,
  CreateRepositoryRequest,
  UpdateRepositoryRequest,
} from "../../domain/types";

// Get all repositories for a project (org-scoped)
export const getRepositories = async (
  workspaceId: string,
  projectId: string
): Promise<ProjectRepository[]> => {
  const result = await db
    .select({
      id: projectRepositories.id,
      projectId: projectRepositories.projectId,
      name: projectRepositories.name,
      url: projectRepositories.url,
      provider: projectRepositories.provider,
      isMonorepo: projectRepositories.isMonorepo,
      order: projectRepositories.order,
      createdAt: projectRepositories.createdAt,
      updatedAt: projectRepositories.updatedAt,
    })
    .from(projectRepositories)
    .innerJoin(projects, eq(projectRepositories.projectId, projects.id))
    .where(
      and(
        eq(projectRepositories.projectId, projectId),
        eq(projects.workspaceId, workspaceId)
      )
    )
    .orderBy(projectRepositories.order);

  return result as ProjectRepository[];
};

// Get the first repository for a workspace (across all projects)
// Used when a scheduled agent config has no projectId
export const getOrgPrimaryRepository = async (
  workspaceId: string
): Promise<(ProjectRepository & { projectId: string }) | null> => {
  const [result] = await db
    .select({
      id: projectRepositories.id,
      projectId: projectRepositories.projectId,
      name: projectRepositories.name,
      url: projectRepositories.url,
      provider: projectRepositories.provider,
      isMonorepo: projectRepositories.isMonorepo,
      order: projectRepositories.order,
      createdAt: projectRepositories.createdAt,
      updatedAt: projectRepositories.updatedAt,
    })
    .from(projectRepositories)
    .innerJoin(projects, eq(projectRepositories.projectId, projects.id))
    .where(eq(projects.workspaceId, workspaceId))
    .orderBy(projectRepositories.order)
    .limit(1);

  return result ? (result as ProjectRepository & { projectId: string }) : null;
};

// Create a repository (org-scoped: verifies project belongs to org)
export const createRepository = async (
  workspaceId: string,
  projectId: string,
  data: CreateRepositoryRequest
): Promise<ProjectRepository | null> => {
  // Verify the project belongs to the workspace
  const [project] = await db
    .select({ id: projects.id })
    .from(projects)
    .where(
      and(
        eq(projects.id, projectId),
        eq(projects.workspaceId, workspaceId)
      )
    )
    .limit(1);

  if (!project) return null;

  const [newRepo] = await db
    .insert(projectRepositories)
    .values({
      projectId,
      name: data.name,
      url: data.url,
      provider: data.provider || "github",
      isMonorepo: data.isMonorepo ?? false,
      order: data.order ?? 0,
    })
    .returning();

  return newRepo as ProjectRepository;
};

// Update a repository (org-scoped: verifies repo's project belongs to org)
export const updateRepository = async (
  workspaceId: string,
  id: string,
  data: UpdateRepositoryRequest
): Promise<ProjectRepository | null> => {
  // Find the repository and verify org ownership via project
  const [existing] = await db
    .select({ id: projectRepositories.id })
    .from(projectRepositories)
    .innerJoin(projects, eq(projectRepositories.projectId, projects.id))
    .where(
      and(
        eq(projectRepositories.id, id),
        eq(projects.workspaceId, workspaceId)
      )
    )
    .limit(1);

  if (!existing) return null;

  const [updated] = await db
    .update(projectRepositories)
    .set({
      ...data,
      updatedAt: new Date(),
    })
    .where(eq(projectRepositories.id, id))
    .returning();

  if (!updated) return null;

  return updated as ProjectRepository;
};

// Delete a repository (org-scoped: verifies repo's project belongs to org)
export const deleteRepository = async (
  workspaceId: string,
  id: string
): Promise<boolean> => {
  // Find the repository and verify org ownership via project
  const [existing] = await db
    .select({ id: projectRepositories.id })
    .from(projectRepositories)
    .innerJoin(projects, eq(projectRepositories.projectId, projects.id))
    .where(
      and(
        eq(projectRepositories.id, id),
        eq(projects.workspaceId, workspaceId)
      )
    )
    .limit(1);

  if (!existing) return false;

  const result = await db
    .delete(projectRepositories)
    .where(eq(projectRepositories.id, id))
    .returning();
  return result.length > 0;
};

// Get all GitHub repo URLs across projects in a workspace (for filtering available repos)
export const getAllGithubRepoUrls = async (workspaceId: string): Promise<string[]> => {
  const rows = await db
    .select({ url: projectRepositories.url })
    .from(projectRepositories)
    .innerJoin(projects, eq(projectRepositories.projectId, projects.id))
    .where(
      and(
        eq(projectRepositories.provider, "github"),
        eq(projects.workspaceId, workspaceId)
      )
    );

  return rows.map((r) => r.url);
};

// Reorder repositories for a project (org-scoped)
export const reorderRepositories = async (
  workspaceId: string,
  projectId: string,
  repoIds: string[]
): Promise<void> => {
  // Verify the project belongs to the workspace
  const [project] = await db
    .select({ id: projects.id })
    .from(projects)
    .where(
      and(
        eq(projects.id, projectId),
        eq(projects.workspaceId, workspaceId)
      )
    )
    .limit(1);

  if (!project) return;

  await Promise.all(
    repoIds.map((repoId, index) =>
      db
        .update(projectRepositories)
        .set({ order: index, updatedAt: new Date() })
        .where(
          and(
            eq(projectRepositories.id, repoId),
            eq(projectRepositories.projectId, projectId)
          )
        )
    )
  );
};

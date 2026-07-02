import { db } from "../../client";
import {
  projects,
  projectDocLinks,
  projectNotes,
  projectRepositories,
  boards,
  workItems,
  boardColumns,
  workspace,
  member,
  ideaItems,
  milestones,
} from "../../schema";
import { eq, and, or, ilike, desc, sql, inArray, isNull } from "drizzle-orm";
import type {
  ProjectWithRelations,
  CreateProjectRequest,
  UpdateProjectRequest,
  ProjectFilters,
} from "../../domain/types";
import type { PaginationParams } from "../../domain/types";

const PROJECT_BASE_SELECT = {
  id: projects.id,
  name: projects.name,
  description: projects.description,
  folderPath: projects.folderPath,
  color: projects.color,
  icon: projects.icon,
  status: projects.status,
  clientName: projects.clientName,
  productionUrl: projects.productionUrl,
  stagingUrl: projects.stagingUrl,
  screenshotUrl: projects.screenshotUrl,
  techStack: projects.techStack,
  workspaceId: projects.workspaceId,
  startDate: projects.startDate,
  targetDate: projects.targetDate,
  createdAt: projects.createdAt,
  updatedAt: projects.updatedAt,
  defaultProvider: projects.defaultProvider,
} as const;

const getErrorMessage = (error: unknown): string => {
  if (!error) {
    return "";
  }

  if (typeof error === "string") {
    return error;
  }

  if (error instanceof Error) {
    return error.message;
  }

  if (typeof error === "object" && "message" in error && typeof error.message === "string") {
    return error.message;
  }

  return "";
};

const isMissingNightlyValidationColumnError = (error: unknown): boolean => {
  if (!error || typeof error !== "object") {
    return false;
  }

  const code = "code" in error ? error.code : undefined;
  const message = getErrorMessage(error);
  const causeMessage =
    "cause" in error ? getErrorMessage(error.cause) : "";
  const combinedMessage = `${message} ${causeMessage}`;

  return (
    combinedMessage.includes("nightly_validation") &&
    (code === "42703" ||
      combinedMessage.includes("does not exist") ||
      combinedMessage.includes("column"))
  );
};

// Helper: query work item counts grouped by type for a given project
const getWorkItemCountsByType = async (projectId: string) => {
  const rows = await db
    .select({
      type: workItems.type,
      total: sql<number>`count(*)::int`,
      completed: sql<number>`count(*) filter (where ${boardColumns.isDone} = true)::int`,
    })
    .from(workItems)
    .leftJoin(boardColumns, eq(workItems.boardColumnId, boardColumns.id))
    .where(and(eq(workItems.projectId, projectId), isNull(workItems.archivedAt)))
    .groupBy(workItems.type);

  let epicCount = 0, featureCount = 0, storyCount = 0, taskCount = 0;
  let completedEpicCount = 0, completedFeatureCount = 0, completedStoryCount = 0, completedTaskCount = 0;

  for (const row of rows) {
    switch (row.type) {
      case "epic":
        epicCount = row.total;
        completedEpicCount = row.completed;
        break;
      case "feature":
        featureCount = row.total;
        completedFeatureCount = row.completed;
        break;
      case "story":
        storyCount = row.total;
        completedStoryCount = row.completed;
        break;
      case "task":
        taskCount = row.total;
        completedTaskCount = row.completed;
        break;
    }
  }

  return {
    epicCount,
    featureCount,
    storyCount,
    taskCount,
    completedEpicCount,
    completedFeatureCount,
    completedStoryCount,
    completedTaskCount,
    // backward compat: main number = tasks only
    workItemsCount: taskCount,
    completedItemsCount: completedTaskCount,
  };
};

// Get all projects with pagination and filters
export const getProjects = async (
  workspaceIdOrPagination: string | PaginationParams,
  paginationOrFilters?: PaginationParams | ProjectFilters,
  maybeFilters?: ProjectFilters
): Promise<{ projects: ProjectWithRelations[]; total: number }> => {
  // Support two calling conventions:
  //   getProjects(workspaceId, pagination, filters?)  -- route handler (3-arg)
  //   getProjects(pagination, filters?)                  -- webhook handler (2-arg, no org scope)
  let workspaceId: string | undefined;
  let pagination: PaginationParams;
  let filters: ProjectFilters | undefined;

  if (typeof workspaceIdOrPagination === "string") {
    workspaceId = workspaceIdOrPagination;
    pagination = paginationOrFilters as PaginationParams;
    filters = maybeFilters;
  } else {
    workspaceId = undefined;
    pagination = workspaceIdOrPagination;
    filters = paginationOrFilters as ProjectFilters | undefined;
  }

  // Build workspace condition based on filter priority:
  // 1. filters.workspaceIds (multi-org): projects in ANY of those orgs + personal (null org)
  // 2. filters.personal (alone): only projects with no workspace
  // 3. filters.workspaceId (single org from filter): that specific org
  // 4. Fallback: use the workspaceId function parameter (backward-compatible default)
  // 5. No org constraint at all (webhook handler scenario)
  const conditions: ReturnType<typeof eq>[] = [];

  if (filters?.workspaceIds && filters.workspaceIds.length > 0) {
    conditions.push(
      or(
        inArray(projects.workspaceId, filters.workspaceIds),
        isNull(projects.workspaceId)
      )!
    );
  } else if (filters?.personal) {
    conditions.push(isNull(projects.workspaceId));
  } else if (filters?.workspaceId) {
    conditions.push(eq(projects.workspaceId, filters.workspaceId));
  } else if (workspaceId) {
    conditions.push(eq(projects.workspaceId, workspaceId));
  }
  // else: no org condition -- return projects from all orgs (webhook use case)

  if (filters?.search) {
    conditions.push(
      or(
        ilike(projects.name, `%${filters.search}%`),
        ilike(projects.description, `%${filters.search}%`)
      )!
    );
  }

  if (filters?.status) {
    conditions.push(eq(projects.status, filters.status));
  } else if (!filters?.includeArchived) {
    // Exclude archived projects by default unless explicitly requested
    conditions.push(sql`${projects.status} != 'archived'`);
  }

  // IMPORTANT:
  // Project listing is scoped by workspace/workspace, not by explicit
  // project_members rows. A user who belongs to the active workspace should
  // see the workspace's projects even if older projects are missing
  // backfilled project_members entries. This keeps `/projects` and `/plan`
  // aligned with the active workspace selector in the UI.

  const whereClause = and(...conditions);

  const [projectsResult, countResult] = await Promise.all([
    db
      .select({
        ...PROJECT_BASE_SELECT,
        workspaceName: workspace.name,
      })
      .from(projects)
      .leftJoin(workspace, eq(projects.workspaceId, workspace.id))
      .where(whereClause)
      .orderBy(desc(projects.createdAt))
      .limit(pagination.limit)
      .offset(pagination.offset),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(projects)
      .where(whereClause),
  ]);

  // Get related data for each project
  const projectsWithRelations = await Promise.all(
    projectsResult.map(async ({ workspaceName, ...project }) => {
      const [docLinksResult, repositoriesResult, notesResult, typeCounts] =
        await Promise.all([
          db
            .select()
            .from(projectDocLinks)
            .where(eq(projectDocLinks.projectId, project.id))
            .orderBy(projectDocLinks.order),
          db
            .select()
            .from(projectRepositories)
            .where(eq(projectRepositories.projectId, project.id))
            .orderBy(projectRepositories.order),
          db
            .select()
            .from(projectNotes)
            .where(eq(projectNotes.projectId, project.id))
            .orderBy(projectNotes.order),
          getWorkItemCountsByType(project.id),
        ]);

      return {
        ...project,
        workspaceName: workspaceName ?? null,
        docLinks: docLinksResult,
        repositories: repositoriesResult,
        notes: notesResult,
        ...typeCounts,
      };
    })
  );

  return {
    projects: projectsWithRelations as ProjectWithRelations[],
    total: countResult[0]?.count ?? 0,
  };
};

// Get project by ID with relations
export const getProjectById = async (
  workspaceId: string,
  id: string
): Promise<ProjectWithRelations | null> => {
  const [result] = await db
    .select({
      ...PROJECT_BASE_SELECT,
      workspaceName: workspace.name,
    })
    .from(projects)
    .leftJoin(workspace, eq(projects.workspaceId, workspace.id))
    .where(and(eq(projects.id, id), eq(projects.workspaceId, workspaceId)))
    .limit(1);

  if (!result) return null;
  const { workspaceName, ...project } = result;

  const [docLinksResult, repositoriesResult, notesResult, typeCounts] =
    await Promise.all([
      db
        .select()
        .from(projectDocLinks)
        .where(eq(projectDocLinks.projectId, id))
        .orderBy(projectDocLinks.order),
      db
        .select()
        .from(projectRepositories)
        .where(eq(projectRepositories.projectId, id))
        .orderBy(projectRepositories.order),
      db
        .select()
        .from(projectNotes)
        .where(eq(projectNotes.projectId, id))
        .orderBy(projectNotes.order),
      getWorkItemCountsByType(id),
    ]);

  return {
    ...project,
    workspaceName: workspaceName ?? null,
    docLinks: docLinksResult,
    repositories: repositoriesResult,
    notes: notesResult,
    ...typeCounts,
  } as ProjectWithRelations;
};

// Create project
export const createProject = async (
  workspaceId: string,
  data: CreateProjectRequest
): Promise<ProjectWithRelations> => {
  const [newProject] = await db
    .insert(projects)
    .values({
      name: data.name,
      description: data.description,
      folderPath: data.folderPath,
      color: data.color || "#6366f1",
      icon: data.icon,
      status: data.status || "active",
      clientName: data.clientName,
      productionUrl: data.productionUrl,
      stagingUrl: data.stagingUrl,
      techStack: data.techStack,
      workspaceId,
      startDate: data.startDate ? new Date(data.startDate) : undefined,
      targetDate: data.targetDate ? new Date(data.targetDate) : undefined,
    })
    .returning({ id: projects.id });

  if (!newProject) throw new Error("Failed to create project");
  return getProjectById(workspaceId, newProject.id) as Promise<ProjectWithRelations>;
};

// Update project
export const updateProject = async (
  workspaceId: string,
  id: string,
  data: UpdateProjectRequest
): Promise<ProjectWithRelations | null> => {
  const { startDate, targetDate, ...rest } = data;

  const [updated] = await db
    .update(projects)
    .set({
      ...rest,
      ...(startDate !== undefined && {
        startDate: startDate ? new Date(startDate) : null,
      }),
      ...(targetDate !== undefined && {
        targetDate: targetDate ? new Date(targetDate) : null,
      }),
      updatedAt: new Date(),
    })
    .where(and(eq(projects.id, id), eq(projects.workspaceId, workspaceId)))
    .returning({
      id: projects.id,
      workspaceId: projects.workspaceId,
    });

  if (!updated) return null;

  return getProjectById(updated.workspaceId ?? workspaceId, id);
};

// Archive project (logical delete via status)
export const archiveProject = async (
  workspaceId: string,
  id: string
): Promise<Awaited<ReturnType<typeof getProjectById>> | null> => {
  const [updated] = await db
    .update(projects)
    .set({
      status: "archived" as const,
      updatedAt: new Date(),
    })
    .where(and(eq(projects.id, id), eq(projects.workspaceId, workspaceId)))
    .returning({ id: projects.id });

  if (!updated) return null;
  return getProjectById(workspaceId, id);
};

// Delete project
export const deleteProject = async (workspaceId: string, id: string): Promise<boolean> => {
  const result = await db
    .delete(projects)
    .where(and(eq(projects.id, id), eq(projects.workspaceId, workspaceId)))
    .returning({ id: projects.id });
  return result.length > 0;
};

// Transfer project to a different workspace, moving related entities atomically.
// Boards are org-scoped, so we remap work items to equivalent boards in the
// destination org (matched by area) and equivalent columns (matched by name).
export const transferProject = async (
  currentOrgId: string,
  projectId: string,
  targetOrgId: string
): Promise<ProjectWithRelations | null> => {
  return db.transaction(async (tx) => {
    // 1. Update the project's workspaceId
    const [updated] = await tx
      .update(projects)
      .set({ workspaceId: targetOrgId, updatedAt: new Date() })
      .where(and(eq(projects.id, projectId), eq(projects.workspaceId, currentOrgId)))
      .returning({ id: projects.id });

    if (!updated) return null;

    // 2. Move ideaItems linked to this project
    await tx
      .update(ideaItems)
      .set({ workspaceId: targetOrgId, updatedAt: new Date() })
      .where(and(eq(ideaItems.projectId, projectId), eq(ideaItems.workspaceId, currentOrgId)));

    // 3. Move milestones linked to this project
    await tx
      .update(milestones)
      .set({ workspaceId: targetOrgId, updatedAt: new Date() })
      .where(and(eq(milestones.projectId, projectId), eq(milestones.workspaceId, currentOrgId)));

    // 4. Remap work items to boards in the destination workspace.
    // Boards belong to workspaces (not projects), so work items need their
    // boardId/boardColumnId updated to point at equivalent boards in the target org.

    // 4a. Get the project's work items that have a board assignment
    const projectWorkItems = await tx
      .select({
        id: workItems.id,
        boardId: workItems.boardId,
        boardColumnId: workItems.boardColumnId,
      })
      .from(workItems)
      .where(eq(workItems.projectId, projectId));

    if (projectWorkItems.length === 0) return null;

    // 4b. Find which of those boards belong to the SOURCE org (need remapping)
    const workItemBoardIds = [...new Set(projectWorkItems.map((wi) => wi.boardId).filter(Boolean))] as string[];
    if (workItemBoardIds.length === 0) return null;

    const sourceBoardRows = await tx
      .select({ id: boards.id, area: boards.area, workspaceId: boards.workspaceId })
      .from(boards)
      .where(
        and(
          inArray(boards.id, workItemBoardIds),
          eq(boards.workspaceId, currentOrgId)
        )
      );

    if (sourceBoardRows.length === 0) return null; // All boards already in target org or unrelated

    const sourceBoardIds = new Set(sourceBoardRows.map((b) => b.id));

    // Items that need remapping: those currently on a source-org board
    const itemsToRemap = projectWorkItems.filter((wi) => wi.boardId && sourceBoardIds.has(wi.boardId));
    if (itemsToRemap.length === 0) return null;

    // 4c. Get columns for the source boards (for name matching)
    const sourceColRows = await tx
      .select({ id: boardColumns.id, boardId: boardColumns.boardId, name: boardColumns.name })
      .from(boardColumns)
      .where(inArray(boardColumns.boardId, [...sourceBoardIds]));

    const sourceColMap = new Map(sourceColRows.map((c) => [c.id, c]));
    const sourceBoardAreaMap = new Map(sourceBoardRows.map((b) => [b.id, b.area]));

    // 4d. Find boards in the destination org, indexed by area
    const destBoardRows = await tx
      .select({ id: boards.id, area: boards.area })
      .from(boards)
      .where(eq(boards.workspaceId, targetOrgId));

    // Build lookup: area -> { boardId, columnsByName, backlogColumnId }
    const destByArea = new Map<string, { boardId: string; columnsByName: Map<string, string>; backlogColId: string | null }>();
    for (const db_ of destBoardRows) {
      if (destByArea.has(db_.area)) continue; // Use first board per area

      const cols = await tx
        .select({ id: boardColumns.id, name: boardColumns.name, role: boardColumns.role })
        .from(boardColumns)
        .where(eq(boardColumns.boardId, db_.id));

      const backlogCol = cols.find((c) => c.role === "backlog");
      destByArea.set(db_.area, {
        boardId: db_.id,
        columnsByName: new Map(cols.map((c) => [c.name, c.id])),
        backlogColId: backlogCol?.id ?? null,
      });
    }

    // 4e. Remap each work item
    const now = new Date();
    for (const wi of itemsToRemap) {
      const sourceArea = sourceBoardAreaMap.get(wi.boardId!);
      if (!sourceArea) continue;

      const dest = destByArea.get(sourceArea);
      if (!dest) {
        // No matching board in destination org for this area -- skip (leave as-is)
        continue;
      }

      // Try to match column by name
      const sourceCol = wi.boardColumnId ? sourceColMap.get(wi.boardColumnId) : undefined;
      const destColId = sourceCol ? dest.columnsByName.get(sourceCol.name) : undefined;

      // Fallback to backlog column, then first available column
      const finalColId = destColId ?? dest.backlogColId ?? [...dest.columnsByName.values()][0];
      if (!finalColId) continue; // Destination board has no columns, skip

      await tx
        .update(workItems)
        .set({
          boardId: dest.boardId,
          boardColumnId: finalColId,
          updatedAt: now,
        })
        .where(eq(workItems.id, wi.id));
    }

    return null; // Caller will fetch the full project with relations
  });
};

/**
 * Given a projectId, resolve the workspaceId directly from the projects table.
 * Used by API-key authenticated routes (no user session) that need org context.
 * Returns null if the project is not found or has no workspaceId.
 */
export const getWorkspaceIdByProjectId = async (
  projectId: string
): Promise<string | null> => {
  const [row] = await db
    .select({ workspaceId: projects.workspaceId })
    .from(projects)
    .where(eq(projects.id, projectId))
    .limit(1);
  return row?.workspaceId ?? null;
};

/**
 * Resolves the workspaceId for a project, verifying that the given user
 * is a member of that workspace. Used by MCP auth to support multi-org
 * API keys: the project determines the active workspace context.
 *
 * Returns the workspaceId if valid, null otherwise.
 */
export const resolveProjectWorkspace = async (
  projectId: string,
  userId: string
): Promise<string | null> => {
  const [row] = await db
    .select({ workspaceId: projects.workspaceId })
    .from(projects)
    .where(eq(projects.id, projectId))
    .limit(1);

  const orgId = row?.workspaceId;
  if (!orgId) return null;

  const [membership] = await db
    .select({ id: member.id })
    .from(member)
    .where(and(eq(member.workspaceId, orgId), eq(member.userId, userId)))
    .limit(1);

  return membership ? orgId : null;
};

// ---------------------------------------------------------------------------
// Skill Config
// ---------------------------------------------------------------------------

export interface SkillConfig {
  skillSet: "platform" | "custom";
  customSkillsUrl: string | null;
  disabledSkills: string[];
  agentInstructions: string;
}

const DEFAULT_SKILL_CONFIG: SkillConfig = {
  skillSet: "platform",
  customSkillsUrl: null,
  disabledSkills: [],
  agentInstructions: "",
};

const normalizeSkillConfig = (value: unknown): SkillConfig => {
  if (!value || typeof value !== "object") {
    return DEFAULT_SKILL_CONFIG;
  }

  const config = value as Partial<SkillConfig>;
  const skillSet =
    config.skillSet === "platform" || config.skillSet === "custom"
      ? config.skillSet
      : DEFAULT_SKILL_CONFIG.skillSet;

  return {
    skillSet,
    customSkillsUrl:
      typeof config.customSkillsUrl === "string"
        ? config.customSkillsUrl
        : DEFAULT_SKILL_CONFIG.customSkillsUrl,
    disabledSkills: Array.isArray(config.disabledSkills)
      ? config.disabledSkills.filter((s): s is string => typeof s === "string")
      : DEFAULT_SKILL_CONFIG.disabledSkills,
    agentInstructions:
      typeof config.agentInstructions === "string"
        ? config.agentInstructions
        : DEFAULT_SKILL_CONFIG.agentInstructions,
  };
};

export const getSkillConfig = async (
  projectId: string,
): Promise<SkillConfig> => {
  const [row] = await db
    .select({ skillConfig: projects.skillConfig })
    .from(projects)
    .where(eq(projects.id, projectId))
    .limit(1);

  return normalizeSkillConfig(row?.skillConfig);
};

export const updateSkillConfig = async (
  projectId: string,
  config: SkillConfig,
): Promise<SkillConfig> => {
  const normalized = normalizeSkillConfig(config);
  await db
    .update(projects)
    .set({
      skillConfig: normalized,
      updatedAt: new Date(),
    })
    .where(eq(projects.id, projectId));

  return normalized;
};

// ---------------------------------------------------------------------------
// Nightly Validation
// ---------------------------------------------------------------------------

export interface NightlyValidationSettings {
  enabled: boolean;
  startHour: number;
  endHour: number;
  timezone: string;
  provider: "claude-code" | "codex" | "zipu" | "grok";
}

const DEFAULT_NIGHTLY_VALIDATION: NightlyValidationSettings = {
  enabled: false,
  startHour: 1,
  endHour: 6,
  timezone: "Europe/Madrid",
  provider: "claude-code",
};

const normalizeNightlyValidationSettings = (
  value: unknown,
): NightlyValidationSettings => {
  if (!value || typeof value !== "object") {
    return DEFAULT_NIGHTLY_VALIDATION;
  }

  const config = value as Partial<NightlyValidationSettings>;
  const provider =
    config.provider === "claude-code" ||
    config.provider === "codex" ||
    config.provider === "zipu" ||
    config.provider === "grok"
      ? config.provider
      : DEFAULT_NIGHTLY_VALIDATION.provider;

  return {
    enabled:
      typeof config.enabled === "boolean"
        ? config.enabled
        : DEFAULT_NIGHTLY_VALIDATION.enabled,
    startHour:
      typeof config.startHour === "number"
        ? config.startHour
        : DEFAULT_NIGHTLY_VALIDATION.startHour,
    endHour:
      typeof config.endHour === "number"
        ? config.endHour
        : DEFAULT_NIGHTLY_VALIDATION.endHour,
    timezone:
      typeof config.timezone === "string" && config.timezone.length > 0
        ? config.timezone
        : DEFAULT_NIGHTLY_VALIDATION.timezone,
    provider,
  };
};

export const getProjectNightlyValidation = async (
  projectId: string,
): Promise<NightlyValidationSettings> => {
  try {
    const [row] = await db
      .select({ nightlyValidation: projects.nightlyValidation })
      .from(projects)
      .where(eq(projects.id, projectId))
      .limit(1);

    return normalizeNightlyValidationSettings(row?.nightlyValidation);
  } catch (error) {
    if (isMissingNightlyValidationColumnError(error)) {
      throw new Error(
        'The "projects.nightly_validation" column is missing. Run database migration 0098_brave_champions.sql.',
      );
    }

    throw error;
  }
};

export const updateProjectNightlyValidation = async (
  projectId: string,
  config: NightlyValidationSettings,
): Promise<void> => {
  try {
    await db
      .update(projects)
      .set({
        nightlyValidation: normalizeNightlyValidationSettings(config),
        updatedAt: new Date(),
      })
      .where(eq(projects.id, projectId));
  } catch (error) {
    if (isMissingNightlyValidationColumnError(error)) {
      throw new Error(
        'The "projects.nightly_validation" column is missing. Run database migration 0098_brave_champions.sql.',
      );
    }

    throw error;
  }
};

// ---------------------------------------------------------------------------
// AI Config
// ---------------------------------------------------------------------------

const VALID_AI_PROVIDERS = ["claude-code", "codex", "zipu", "grok"] as const;
type AiProvider = (typeof VALID_AI_PROVIDERS)[number];

export const getProjectAiConfig = async (
  projectId: string,
): Promise<{ defaultProvider: string | null; agentDefaults: unknown }> => {
  const [row] = await db
    .select({ defaultProvider: projects.defaultProvider, agentDefaults: projects.agentDefaults })
    .from(projects)
    .where(eq(projects.id, projectId))
    .limit(1);
  return { defaultProvider: row?.defaultProvider ?? null, agentDefaults: row?.agentDefaults ?? {} };
};

export const updateProjectAiConfig = async (
  projectId: string,
  defaultProvider: string | null,
  agentDefaults?: unknown,
): Promise<{ defaultProvider: string | null; agentDefaults: unknown }> => {
  const patch: Partial<typeof projects.$inferInsert> = {
    defaultProvider,
    updatedAt: new Date(),
  };
  if (agentDefaults !== undefined) {
    patch.agentDefaults = agentDefaults as (typeof projects.$inferInsert)["agentDefaults"];
  }

  const [updated] = await db
    .update(projects)
    .set(patch)
    .where(eq(projects.id, projectId))
    .returning({ defaultProvider: projects.defaultProvider, agentDefaults: projects.agentDefaults });
  return {
    defaultProvider: updated?.defaultProvider ?? defaultProvider,
    agentDefaults: updated?.agentDefaults ?? agentDefaults ?? {},
  };
};

export const getProjectsWithNightlyValidationEnabled = async (): Promise<
  Array<{
    projectId: string;
    projectName: string;
    workspaceId: string;
    nightlyValidation: NightlyValidationSettings;
  }>
> => {
  try {
    const rows = await db
      .select({
        projectId: projects.id,
        projectName: projects.name,
        workspaceId: projects.workspaceId,
        nightlyValidation: projects.nightlyValidation,
      })
      .from(projects)
      .where(sql`${projects.nightlyValidation}->>'enabled' = 'true'`);

    return rows.map((r) => ({
      projectId: r.projectId,
      projectName: r.projectName,
      workspaceId: r.workspaceId ?? "",
      nightlyValidation: normalizeNightlyValidationSettings(r.nightlyValidation),
    }));
  } catch (error) {
    if (isMissingNightlyValidationColumnError(error)) {
      return [];
    }

    throw error;
  }
};

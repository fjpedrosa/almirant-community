import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  getAllBoards,
  getProjectById,
  getWorkItems,
  getWorkItemById,
  getWorkItemHierarchy,
  getWorkItemsByIds,
  getWorkItemsByTaskIds,
  bulkMoveWorkItems,
  setWorkItemAiProcessing,
  updateWorkItem,
  getDependencies,
  getDependents,
  getDependenciesBatch,
  getDependentsBatch,
  getWorkItemEventsByWorkItemId,
  getDocuments,
  computeVirtualColumns,
  getChildCountsByParentIds,
} from "@almirant/database";
import { wsConnectionManager } from "../../shared/ws/ws-connection-manager";
import { getManagedByAgentFromExtra, getOrganizationIdFromExtra, getProjectIdFromExtra } from "../setup";
import { propagateProviderToParent } from "../../domains/connections/services/propagate-provider";

type ManagedByAgent = "claude-code" | "codex";

type ColumnLike = {
  id: string;
  name: string;
  order: number;
  isDone: boolean | null;
  role?: string | null;
};

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const inferRoleFromName = (name: string): string => {
  const normalized = name.toLowerCase().trim();
  if (normalized.includes("backlog")) return "backlog";
  if (normalized.includes("to do") || normalized.includes("todo")) return "todo";
  if (/progress|doing|en progreso/.test(normalized)) return "in_progress";
  if (/review|revision/.test(normalized)) return "review";
  if (/to\s*document/.test(normalized)) return "to_document";
  if (/testing|test|qa/.test(normalized)) return "testing";
  if (/needs\s*fix|to\s*fix|needs\s*attention/.test(normalized)) return "needs_fix";
  if (/validat/.test(normalized)) return "validating";
  if (/release|deploy|ship/.test(normalized)) return "release";
  if (/done|hecho|completed/.test(normalized)) return "done";
  return "other";
};

const buildColumnMap = (columns: ColumnLike[]) => {
  const byRole = new Map<string, string>();

  for (const column of [...columns].sort((a, b) => a.order - b.order)) {
    const role = column.role && column.role !== "other" ? column.role : inferRoleFromName(column.name);
    if (!byRole.has(role)) {
      byRole.set(role, column.id);
    }
  }

  return {
    backlog: byRole.get("backlog") ?? null,
    todo: byRole.get("todo") ?? null,
    inProgress: byRole.get("in_progress") ?? null,
    review: byRole.get("review") ?? null,
    testing: byRole.get("testing") ?? null,
    needsFix: byRole.get("needs_fix") ?? null,
    validating: byRole.get("validating") ?? null,
    release: byRole.get("release") ?? null,
    toDocument: byRole.get("to_document") ?? null,
    done: byRole.get("done") ?? null,
  };
};

const getStringListMetadata = (
  metadata: Record<string, unknown> | null | undefined,
  key: string,
): string[] => {
  const value = metadata?.[key];
  if (Array.isArray(value)) {
    return value
      .filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0)
      .map((entry) => entry.trim());
  }
  if (typeof value === "string" && value.trim().length > 0) {
    return value
      .split(",")
      .map((entry) => entry.trim())
      .filter(Boolean);
  }
  return [];
};

export const hasDodHumanActionRequirement = (
  metadata: Record<string, unknown> | null | undefined,
): boolean => {
  return metadata?.dod_human_action_required === true
    || metadata?.dod_human_review_required === true
    || metadata?.dod_auto_remediation_blocked === true
    || metadata?.dod_external_validation_required === true
    || getStringListMetadata(metadata, "dod_external_validation_tools").length > 0;
};

const getManagedByFromAiProvider = (aiProvider?: string): ManagedByAgent | undefined => {
  if (aiProvider === "openai") return "codex";
  if (aiProvider === "anthropic") return "claude-code";
  return undefined;
};

const mergeManagedByMetadata = (
  existingMetadata: Record<string, unknown> | undefined,
  incomingMetadata: Record<string, unknown>,
  managedBy?: ManagedByAgent
) => {
  const next = {
    ...(existingMetadata ?? {}),
    ...incomingMetadata,
  };

  const incomingProvider = typeof incomingMetadata.aiProvider === "string"
    ? incomingMetadata.aiProvider
    : undefined;
  const providerManagedBy = getManagedByFromAiProvider(incomingProvider);
  if (providerManagedBy) {
    next.managedBy = providerManagedBy;
    next.managedByAgents = [providerManagedBy];
    return next;
  }

  const agents = new Set<ManagedByAgent>();
  if (managedBy) agents.add(managedBy);

  if (next.managedBy === "codex" || next.managedBy === "claude-code") {
    agents.add(next.managedBy);
  }

  if (Array.isArray(next.managedByAgents)) {
    for (const entry of next.managedByAgents) {
      if (entry === "codex" || entry === "claude-code") {
        agents.add(entry);
      }
    }
  }

  if (agents.size > 0) {
    next.managedByAgents = Array.from(agents);
    next.managedBy = managedBy ?? Array.from(agents)[0];
  }

  return next;
};

type ResolvedLeafTask = Awaited<ReturnType<typeof getWorkItemById>> & { resolvedFrom: string[] };

const resolveToLeafTasks = async (
  organizationId: string,
  item: NonNullable<Awaited<ReturnType<typeof getWorkItemById>>>,
  resolvedFrom: string,
  maxDepth: number,
  seen: Set<string>,
  resolvedMap: Map<string, ResolvedLeafTask>,
  depth = 0
) => {
  if (depth > maxDepth || seen.has(item.id)) return;
  seen.add(item.id);

  const children = await getWorkItemHierarchy(organizationId, item.id);

  if (item.type === "task" && children.length === 0) {
    const existing = resolvedMap.get(item.id);
    if (existing) {
      if (!existing.resolvedFrom.includes(resolvedFrom)) {
        existing.resolvedFrom.push(resolvedFrom);
      }
    } else {
      resolvedMap.set(item.id, { ...item, resolvedFrom: [resolvedFrom] });
    }
    return;
  }

  for (const child of children) {
    const hydrated = await getWorkItemById(child.id, organizationId);
    if (hydrated) {
      await resolveToLeafTasks(organizationId, hydrated, resolvedFrom, maxDepth, seen, resolvedMap, depth + 1);
    }
  }
};

export const registerSkillContextTools = (server: McpServer) => {
  server.tool(
    "resolve_work_items",
    "Resolve work item identifiers (MC-XX task IDs or UUIDs) into full work items, optionally expanded to leaf tasks.",
    {
      ids: z.array(z.string().min(1)).min(1).describe("List of mixed identifiers (task IDs like MC-123, MC-F-57, or UUIDs)"),
      includeLeafTasks: z.boolean().optional().describe("When true (default), recursively resolve non-task items to leaf tasks"),
      maxDepth: z.number().int().min(1).max(10).optional().describe("Max recursion depth when resolving leaf tasks (default: 3)"),
    },
    async (params, extra) => {
      try {
        const organizationId = getOrganizationIdFromExtra(extra);
        if (!organizationId) {
          return { content: [{ type: "text" as const, text: "Error: could not resolve organizationId from API key" }], isError: true };
        }

        const includeLeafTasks = params.includeLeafTasks ?? true;
        const maxDepth = params.maxDepth ?? 3;
        const projectId = getProjectIdFromExtra(extra);

        const uniqueIds = Array.from(new Set(params.ids.map((id) => id.trim()).filter(Boolean)));
        const uuidIds = uniqueIds.filter((id) => UUID_REGEX.test(id));
        const taskIds = uniqueIds.filter((id) => !UUID_REGEX.test(id));

        const [byUuid, byTaskId] = await Promise.all([
          getWorkItemsByIds(organizationId, uuidIds),
          getWorkItemsByTaskIds(organizationId, taskIds),
        ]);

        const foundMap = new Map<string, NonNullable<Awaited<ReturnType<typeof getWorkItemById>>>>();
        for (const item of [...byUuid, ...byTaskId]) {
          if (!projectId || item.projectId === projectId) {
            foundMap.set(item.id, item);
          }
        }

        const matchedInputs = new Set<string>();
        const byTaskIdMap = new Map(byTaskId.filter((item) => item.taskId).map((item) => [item.taskId as string, item]));
        for (const id of uniqueIds) {
          if (UUID_REGEX.test(id)) {
            if ([...foundMap.values()].some((item) => item.id === id)) matchedInputs.add(id);
          } else if (byTaskIdMap.has(id)) {
            matchedInputs.add(id);
          }
        }

        const notFound = uniqueIds.filter((id) => !matchedInputs.has(id));

        if (!includeLeafTasks) {
          return {
            content: [
              {
                type: "text" as const,
                text: JSON.stringify(
                  {
                    inputIds: uniqueIds,
                    notFound,
                    items: [...foundMap.values()],
                  },
                  null,
                  2
                ),
              },
            ],
          };
        }

        const resolvedMap = new Map<string, ResolvedLeafTask>();
        for (const inputId of uniqueIds) {
          let baseItem: NonNullable<Awaited<ReturnType<typeof getWorkItemById>>> | undefined;
          if (UUID_REGEX.test(inputId)) {
            baseItem = [...foundMap.values()].find((item) => item.id === inputId);
          } else {
            baseItem = byTaskIdMap.get(inputId);
          }
          if (!baseItem) continue;

          await resolveToLeafTasks(organizationId, baseItem, inputId, maxDepth, new Set<string>(), resolvedMap);
        }

        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(
                {
                  inputIds: uniqueIds,
                  notFound,
                  items: [...resolvedMap.values()],
                },
                null,
                2
              ),
            },
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Error resolving work items: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
          isError: true,
        };
      }
    }
  );

  server.tool(
    "get_board_context",
    "Get all boards for a project including semantic column role mapping (backlog/in_progress/review/validating/release/done, plus legacy roles when present).",
    {
      projectId: z.string().uuid().optional().describe("Project ID (uses MCP default projectId when omitted)"),
    },
    async (params, extra) => {
      try {
        const organizationId = getOrganizationIdFromExtra(extra);
        if (!organizationId) {
          return { content: [{ type: "text" as const, text: "Error: could not resolve organizationId from API key" }], isError: true };
        }

        const projectId = params.projectId ?? getProjectIdFromExtra(extra);
        if (!projectId) {
          return {
            content: [{ type: "text" as const, text: "Error: projectId is required" }],
            isError: true,
          };
        }

        const boards = await getAllBoards(organizationId);
        const result = boards.map((board) => ({
          id: board.id,
          name: board.name,
          area: board.area,
          columns: board.columns,
          columnMap: buildColumnMap(board.columns),
        }));

        return {
          content: [{ type: "text" as const, text: JSON.stringify({ projectId, boards: result }, null, 2) }],
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Error getting board context: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
          isError: true,
        };
      }
    }
  );

  server.tool(
    "batch_move_work_items",
    "Batch move work items to a target column. Optionally sets AI processing flags/provider metadata for all moved items.",
    {
      workItemIds: z.array(z.string().uuid()).min(1).describe("Work item IDs to move"),
      boardColumnId: z.string().uuid().describe("Target board column ID"),
      setAiProcessing: z.boolean().optional().describe("When true, set isAiProcessing=true for all moved items"),
      aiProvider: z.string().optional().describe("Optional provider (e.g. openai/anthropic) to store in metadata"),
    },
    async (params, extra) => {
      try {
        const organizationId = getOrganizationIdFromExtra(extra);
        if (!organizationId) {
          return { content: [{ type: "text" as const, text: "Error: could not resolve organizationId from API key" }], isError: true };
        }

        const managedByFromClient = getManagedByAgentFromExtra(extra);
        const managedByFromProvider = getManagedByFromAiProvider(params.aiProvider);
        const managedBy = managedByFromProvider ?? managedByFromClient;

        const moved = await bulkMoveWorkItems(organizationId, params.workItemIds, params.boardColumnId);
        if (!moved) {
          return {
            content: [{ type: "text" as const, text: "Error: no work items moved" }],
            isError: true,
          };
        }

        const updatedItems = [];
        for (const workItemId of params.workItemIds) {
          if (params.setAiProcessing) {
            await setWorkItemAiProcessing(organizationId, workItemId, true);
          }

          if (params.aiProvider || managedBy) {
            const item = await getWorkItemById(workItemId, organizationId);
            if (item) {
              const meta = mergeManagedByMetadata(
                (item.metadata as Record<string, unknown>) ?? {},
                {
                  ...(params.aiProvider
                    ? {
                        aiProvider: params.aiProvider,
                        aiReservationProvider: params.aiProvider,
                        aiReserved: true,
                      }
                    : {}),
                },
                managedBy
              );
              await updateWorkItem(organizationId, workItemId, { metadata: meta });
              void propagateProviderToParent(organizationId, workItemId, meta);
            }
          }

          const updated = await getWorkItemById(workItemId, organizationId);
          if (updated) {
            updatedItems.push(updated);
            wsConnectionManager.broadcastToOrganization(organizationId, {
              type: "work-item:updated",
              payload: {
                workItemId,
                boardId: updated.boardId ?? undefined,
                changes: { boardColumnId: params.boardColumnId },
              },
            });
          }
        }

        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(
                {
                  movedCount: updatedItems.length,
                  items: updatedItems,
                  note: "batch_move_work_items uses bulk update and does not run cascade/position logic",
                },
                null,
                2
              ),
            },
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Error batch moving work items: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
          isError: true,
        };
      }
    }
  );

  server.tool(
    "get_dependencies_batch",
    "Get dependencies and dependents for multiple work items in one call.",
    {
      workItemIds: z.array(z.string().uuid()).min(1).describe("Work item IDs to resolve dependencies for"),
    },
    async (params, extra) => {
      try {
        const organizationId = getOrganizationIdFromExtra(extra);
        if (!organizationId) {
          return { content: [{ type: "text" as const, text: "Error: could not resolve organizationId from API key" }], isError: true };
        }

        const [dependencies, dependents] = await Promise.all([
          getDependenciesBatch(params.workItemIds),
          getDependentsBatch(params.workItemIds),
        ]);

        const grouped = new Map<string, { dependencies: typeof dependencies; dependents: typeof dependents }>();
        for (const id of params.workItemIds) {
          grouped.set(id, { dependencies: [], dependents: [] });
        }

        for (const dep of dependencies) {
          const bucket = grouped.get(dep.workItemId);
          if (bucket) bucket.dependencies.push(dep);
        }
        for (const dep of dependents) {
          const bucket = grouped.get(dep.blockedByWorkItemId);
          if (bucket) bucket.dependents.push(dep);
        }

        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(
                {
                  items: params.workItemIds.map((id) => ({
                    workItemId: id,
                    dependencies: grouped.get(id)?.dependencies ?? [],
                    dependents: grouped.get(id)?.dependents ?? [],
                  })),
                },
                null,
                2
              ),
            },
          ],
        };
      } catch (error) {
        return {
          content: [
            { type: "text" as const, text: `Error getting dependencies batch: ${error instanceof Error ? error.message : String(error)}` },
          ],
          isError: true,
        };
      }
    }
  );

  server.tool(
    "get_implement_context",
    "Resolve identifiers into pending leaf tasks, classify by status, include board mappings, intra-batch dependencies, and precomputed execution waves.",
    {
      ids: z.array(z.string().min(1)).min(1).describe("List of task IDs/UUIDs to implement"),
      projectId: z.string().uuid().optional().describe("Project ID (defaults to MCP session project)"),
    },
    async (params, extra) => {
      try {
        const organizationId = getOrganizationIdFromExtra(extra);
        if (!organizationId) {
          return { content: [{ type: "text" as const, text: "Error: could not resolve organizationId from API key" }], isError: true };
        }

        const projectId = params.projectId ?? getProjectIdFromExtra(extra);
        if (!projectId) {
          return {
            content: [{ type: "text" as const, text: "Error: projectId is required" }],
            isError: true,
          };
        }

        const project = await getProjectById(organizationId, projectId);
        const uniqueInputIds = Array.from(new Set(params.ids.map((id) => id.trim()).filter(Boolean)));

        const uuidIds = uniqueInputIds.filter((id) => UUID_REGEX.test(id));
        const taskIds = uniqueInputIds.filter((id) => !UUID_REGEX.test(id));
        const [byUuid, byTaskId] = await Promise.all([
          getWorkItemsByIds(organizationId, uuidIds),
          getWorkItemsByTaskIds(organizationId, taskIds),
        ]);
        const baseItems = [...byUuid, ...byTaskId].filter((item) => item.projectId === projectId);
        const byTaskIdMap = new Map(byTaskId.filter((item) => item.taskId).map((item) => [item.taskId as string, item]));

        const leafMap = new Map<string, ResolvedLeafTask>();
        for (const rawId of uniqueInputIds) {
          const base = UUID_REGEX.test(rawId)
            ? baseItems.find((item) => item.id === rawId)
            : byTaskIdMap.get(rawId);
          if (!base) continue;
          await resolveToLeafTasks(organizationId, base, rawId, 3, new Set<string>(), leafMap);
        }

        const valid = [] as Array<ResolvedLeafTask & { isValid: true }>;
        const skipped = [] as Array<ResolvedLeafTask & { isValid: false; skipReason: string }>;
        for (const item of leafMap.values()) {
          const column = (item.columnName ?? "").toLowerCase();
          const isValid = column.includes("backlog");
          if (isValid) {
            valid.push({ ...item, isValid: true });
          } else {
            skipped.push({
              ...item,
              isValid: false,
              skipReason: `Column '${item.columnName}' is not pending (expected Backlog)`,
            });
          }
        }

        const boards = await getAllBoards(organizationId);
        const boardContext = boards
          .filter((board) => valid.some((task) => task.boardId === board.id))
          .map((board) => ({
            id: board.id,
            name: board.name,
            columns: board.columns,
            columnMap: buildColumnMap(board.columns),
          }));

        const validIds = valid.map((task) => task.id);
        const depRows = validIds.length > 0 ? await getDependenciesBatch(validIds) : [];
        const validSet = new Set(validIds);
        const adjacency = new Map<string, Set<string>>();
        const inDegree = new Map<string, number>();
        for (const id of validIds) {
          adjacency.set(id, new Set());
          inDegree.set(id, 0);
        }

        for (const dep of depRows) {
          if (!validSet.has(dep.workItemId) || !validSet.has(dep.blockedByWorkItemId)) continue;
          const blockers = adjacency.get(dep.blockedByWorkItemId);
          if (blockers && !blockers.has(dep.workItemId)) {
            blockers.add(dep.workItemId);
            inDegree.set(dep.workItemId, (inDegree.get(dep.workItemId) ?? 0) + 1);
          }
        }

        const waves: Array<{ wave: number; taskIds: string[] }> = [];
        let waveIndex = 1;
        const remaining = new Set(validIds);
        while (remaining.size > 0) {
          const ready = [...remaining].filter((id) => (inDegree.get(id) ?? 0) === 0);
          if (ready.length === 0) {
            waves.push({ wave: waveIndex, taskIds: [...remaining] });
            break;
          }

          waves.push({ wave: waveIndex, taskIds: ready });
          for (const id of ready) {
            remaining.delete(id);
            const outs = adjacency.get(id) ?? new Set();
            for (const out of outs) {
              inDegree.set(out, (inDegree.get(out) ?? 0) - 1);
            }
          }
          waveIndex += 1;
        }

        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(
                {
                  project: project
                    ? {
                        id: project.id,
                        name: project.name,
                        techStack: project.techStack,
                        repositories: project.repositories,
                      }
                    : null,
                  tasks: {
                    valid,
                    skipped,
                  },
                  boardContext,
                  dependencies: depRows.filter(
                    (dep) => validSet.has(dep.workItemId) && validSet.has(dep.blockedByWorkItemId)
                  ),
                  waves,
                },
                null,
                2
              ),
            },
          ],
        };
      } catch (error) {
        return {
          content: [{ type: "text" as const, text: `Error building implement context: ${error instanceof Error ? error.message : String(error)}` }],
          isError: true,
        };
      }
    }
  );

  server.tool(
    "get_ideation_context",
    "Get ideation context (related work items by keywords, potential parents, and dynamic board configuration) in one call.",
    {
      keywords: z.array(z.string().min(1)).min(1).describe("Search keywords"),
      projectId: z.string().uuid().optional().describe("Project ID (defaults to MCP session project)"),
      limit: z.number().int().min(1).max(50).optional().describe("Result limit (default: 20)"),
    },
    async (params, extra) => {
      try {
        const organizationId = getOrganizationIdFromExtra(extra);
        if (!organizationId) {
          return { content: [{ type: "text" as const, text: "Error: could not resolve organizationId from API key" }], isError: true };
        }

        const projectId = params.projectId ?? getProjectIdFromExtra(extra);
        if (!projectId) {
          return {
            content: [{ type: "text" as const, text: "Error: projectId is required" }],
            isError: true,
          };
        }

        const limit = params.limit ?? 20;
        const searches = await Promise.all(
          params.keywords.map((keyword) =>
            getWorkItems(organizationId, { page: 1, limit, offset: 0 }, { projectId, search: keyword })
          )
        );

        const merged = new Map<string, (typeof searches)[number]["items"][number]>();
        for (const block of searches) {
          for (const item of block.items) {
            if (!merged.has(item.id)) {
              merged.set(item.id, item);
            }
          }
        }

        const allItems = [...merged.values()].slice(0, limit);

        const relatedItems = allItems.map((item) => ({
            id: item.id,
            taskId: item.taskId,
            title: item.title,
            type: item.type,
            priority: item.priority,
            columnName: item.columnName,
            descriptionExcerpt: (item.description ?? "").slice(0, 200),
          }));

        const boards = await getAllBoards(organizationId);
        const boardContext = boards.map((board) => ({
          id: board.id,
          name: board.name,
          area: board.area,
          columnMap: buildColumnMap(board.columns),
          columns: board.columns,
        }));

        // Build a column lookup from all boards: columnId -> column
        const columnById = new Map<string, { id: string; order: number; role: string; isDone: boolean }>();
        for (const board of boards) {
          for (const col of board.columns) {
            columnById.set(col.id, { id: col.id, order: col.order, role: col.role, isDone: col.isDone });
          }
        }

        // Filter potentialParents to only include those in backlog state
        const parentCandidates = allItems.filter((item) => item.type === "epic" || item.type === "feature");

        // Separate parents with a direct boardColumnId from those without
        const parentsWithColumn = parentCandidates.filter((item) => item.boardColumnId != null);
        const parentsWithoutColumn = parentCandidates.filter((item) => item.boardColumnId == null);

        // Parents with a direct boardColumnId: check if their column role is "backlog"
        const directBacklogIds = new Set<string>();
        for (const item of parentsWithColumn) {
          const col = columnById.get(item.boardColumnId!);
          if (col && col.role === "backlog") {
            directBacklogIds.add(item.id);
          }
        }

        // Parents without boardColumnId: use computeVirtualColumns to determine virtual state
        // Gather all board columns for the computation
        const allColumns = [...columnById.values()];
        const virtualBacklogIds = new Set<string>();
        if (parentsWithoutColumn.length > 0) {
          const parentIds = parentsWithoutColumn.map((item) => item.id);
          const { virtualColumnMap } = await computeVirtualColumns(parentIds, allColumns);
          for (const item of parentsWithoutColumn) {
            const virtualColId = virtualColumnMap.get(item.id);
            if (virtualColId) {
              const col = columnById.get(virtualColId);
              if (col && col.role === "backlog") {
                virtualBacklogIds.add(item.id);
              }
            }
            // If no virtualColId (no descendants), item is excluded — indeterminate state
          }
        }

        const backlogParentIds = new Set([...directBacklogIds, ...virtualBacklogIds]);
        /** @deprecated Use potentialRefinements instead. Kept for backwards compatibility with external skills/runners. */
        const potentialParents = relatedItems.filter(
          (item) => (item.type === "epic" || item.type === "feature") && backlogParentIds.has(item.id)
        );

        // ── potentialRefinements ──
        // Broader than potentialParents: includes epic/feature/story/task in backlog, excludes ideas and archived items.
        const nonArchivedItems = allItems.filter(
          (item) => !(item as unknown as { archivedAt: Date | null }).archivedAt
        );

        const refinementExcludeTypes = new Set(["idea"]);
        const refinementCandidates = nonArchivedItems.filter(
          (item) => !refinementExcludeTypes.has(item.type)
        );

        // Separate tasks (direct column) from parent types (epic/feature/story — virtual column)
        const taskCandidates = refinementCandidates.filter(
          (item) => item.type === "task" && item.boardColumnId != null && !item.parentId
        );
        const storyCandidates = refinementCandidates.filter(
          (item) => item.type === "story"
        );
        const epicFeatureCandidates = refinementCandidates.filter(
          (item) => item.type === "epic" || item.type === "feature"
        );

        // Tasks: check direct column role = backlog
        const backlogTaskIds = new Set<string>();
        for (const item of taskCandidates) {
          const col = columnById.get(item.boardColumnId!);
          if (col && col.role === "backlog") {
            backlogTaskIds.add(item.id);
          }
        }

        // Epic/feature: reuse already computed backlogParentIds
        // Story: compute virtual columns separately
        const backlogStoryIds = new Set<string>();
        if (storyCandidates.length > 0) {
          const storyIds = storyCandidates.map((item) => item.id);
          const { virtualColumnMap: storyVirtualMap } = await computeVirtualColumns(storyIds, allColumns);
          for (const item of storyCandidates) {
            const virtualColId = storyVirtualMap.get(item.id);
            if (virtualColId) {
              const col = columnById.get(virtualColId);
              if (col && col.role === "backlog") {
                backlogStoryIds.add(item.id);
              }
            }
          }
        }

        // Combine all refinement candidate IDs that are in backlog
        const refinementIds = new Set([
          ...backlogTaskIds,
          ...backlogStoryIds,
          ...[...backlogParentIds].filter((id) =>
            epicFeatureCandidates.some((item) => item.id === id)
          ),
        ]);

        // Batch fetch child counts for all refinement candidates
        const refinementIdArray = [...refinementIds];
        const childCountMap = refinementIdArray.length > 0
          ? await getChildCountsByParentIds(refinementIdArray)
          : new Map<string, number>();

        const potentialRefinements = relatedItems
          .filter((item) => refinementIds.has(item.id))
          .map((item) => {
            const childCount = childCountMap.get(item.id) ?? 0;
            return {
              id: item.id,
              taskId: item.taskId,
              title: item.title,
              type: item.type,
              priority: item.priority,
              columnName: item.columnName,
              descriptionExcerpt: item.descriptionExcerpt,
              hasChildren: childCount > 0,
              childCount,
            };
          });

        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(
                {
                  projectId,
                  keywords: params.keywords,
                  relatedItems,
                  /** @deprecated Use potentialRefinements instead. Kept for backwards compatibility. */
                  potentialParents,
                  potentialRefinements,
                  boards: boardContext,
                },
                null,
                2
              ),
            },
          ],
        };
      } catch (error) {
        return {
          content: [{ type: "text" as const, text: `Error building ideation context: ${error instanceof Error ? error.message : String(error)}` }],
          isError: true,
        };
      }
    }
  );

  server.tool(
    "get_review_context",
    "Get full review context for a task/feature: item details, board routing columns, dependencies, siblings, and reviewable children.",
    {
      taskId: z.string().min(1).describe("Task identifier (UUID or taskId like MC-123)"),
      featureReview: z.boolean().optional().describe("When true, include reviewable children for feature/epic review"),
    },
    async (params, extra) => {
      try {
        const organizationId = getOrganizationIdFromExtra(extra);
        if (!organizationId) {
          return { content: [{ type: "text" as const, text: "Error: could not resolve organizationId from API key" }], isError: true };
        }

        const projectId = getProjectIdFromExtra(extra);
        const isUuid = UUID_REGEX.test(params.taskId);

        let item = isUuid
          ? await getWorkItemById(params.taskId, organizationId)
          : (await getWorkItemsByTaskIds(organizationId, [params.taskId]))[0] ?? null;

        if (!item) {
          return {
            content: [{ type: "text" as const, text: `Error: work item '${params.taskId}' not found` }],
            isError: true,
          };
        }
        if (projectId && item.projectId !== projectId) {
          return {
            content: [{ type: "text" as const, text: `Error: work item '${params.taskId}' is outside current project context` }],
            isError: true,
          };
        }

        const boards = await getAllBoards(organizationId);
        const board = boards.find((b) => b.id === item.boardId);
        if (!board) {
          return {
            content: [{ type: "text" as const, text: `Error: board '${item.boardId}' not found` }],
            isError: true,
          };
        }

        const columnMap = buildColumnMap(board.columns);
        const [dependencies, dependents, events] = await Promise.all([
          getDependencies(item.id),
          getDependents(item.id),
          getWorkItemEventsByWorkItemId(item.id, { limit: 20 }),
        ]);

        let siblings: Awaited<ReturnType<typeof getWorkItemHierarchy>> = [];
        if (item.parentId) {
          siblings = (await getWorkItemHierarchy(organizationId, item.parentId)).filter((candidate) => candidate.id !== item.id);
        }

        let reviewableChildren: Awaited<ReturnType<typeof getWorkItemHierarchy>> = [];
        let childrenSummary: Record<string, number> = {};
        if (params.featureReview) {
          const children = await getWorkItemHierarchy(organizationId, item.id);
          for (const child of children) {
            const colName = child.columnName ?? "(no column)";
            childrenSummary[colName] = (childrenSummary[colName] ?? 0) + 1;
          }
          if (columnMap.review) {
            reviewableChildren = children.filter((child) => {
              if (child.boardColumnId !== columnMap.review) return false;
              return !hasDodHumanActionRequirement(
                child.metadata as Record<string, unknown> | null | undefined,
              );
            });
          }
        }

        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(
                {
                  item,
                  board: {
                    id: board.id,
                    name: board.name,
                    columns: board.columns,
                    columnMap,
                    columnIds: {
                      inProgress: columnMap.inProgress,
                      review: columnMap.review,
                      validating: columnMap.validating,
                      release: columnMap.release,
                      testing: columnMap.testing,
                    },
                  },
                  dependencies,
                  dependents,
                  siblings: siblings.map((s) => ({
                    id: s.id,
                    taskId: s.taskId,
                    title: s.title,
                    type: s.type,
                    columnName: s.columnName,
                  })),
                  reviewableChildren,
                  childrenSummary,
                  recentEvents: events,
                },
                null,
                2
              ),
            },
          ],
        };
      } catch (error) {
        return {
          content: [{ type: "text" as const, text: `Error building review context: ${error instanceof Error ? error.message : String(error)}` }],
          isError: true,
        };
      }
    }
  );

  server.tool(
    "get_validate_context",
    "Resolve identifiers into leaf tasks, classify by board column (validatable in Reviewing, skipped otherwise), include board mappings with Validating/Release/In Progress columns, and parent item summaries. Pass includeValidating=true on retries to also pick up items already moved to Validating.",
    {
      ids: z.array(z.string().min(1)).min(1).describe("List of task IDs/UUIDs to validate"),
      projectId: z.string().uuid().optional().describe("Project ID (defaults to MCP session project)"),
      includeValidating: z.boolean().optional().describe("When true, items in the Validating column are also treated as validatable (useful for retries after a runner crash)"),
    },
    async (params, extra) => {
      try {
        const organizationId = getOrganizationIdFromExtra(extra);
        if (!organizationId) {
          return { content: [{ type: "text" as const, text: "Error: could not resolve organizationId from API key" }], isError: true };
        }

        const projectId = params.projectId ?? getProjectIdFromExtra(extra);
        if (!projectId) {
          return {
            content: [{ type: "text" as const, text: "Error: projectId is required" }],
            isError: true,
          };
        }

        const project = await getProjectById(organizationId, projectId);
        const uniqueInputIds = Array.from(new Set(params.ids.map((id) => id.trim()).filter(Boolean)));

        const uuidIds = uniqueInputIds.filter((id) => UUID_REGEX.test(id));
        const taskIds = uniqueInputIds.filter((id) => !UUID_REGEX.test(id));
        const [byUuid, byTaskId] = await Promise.all([
          getWorkItemsByIds(organizationId, uuidIds),
          getWorkItemsByTaskIds(organizationId, taskIds),
        ]);
        const baseItems = [...byUuid, ...byTaskId].filter((item) => item.projectId === projectId);
        const byTaskIdMap = new Map(byTaskId.filter((item) => item.taskId).map((item) => [item.taskId as string, item]));

        const leafMap = new Map<string, ResolvedLeafTask>();
        for (const rawId of uniqueInputIds) {
          const base = UUID_REGEX.test(rawId)
            ? baseItems.find((item) => item.id === rawId)
            : byTaskIdMap.get(rawId);
          if (!base) continue;
          await resolveToLeafTasks(organizationId, base, rawId, 3, new Set<string>(), leafMap);
        }

        const boards = await getAllBoards(organizationId);

        const boardContexts = boards.map((board) => {
          const columnMap = buildColumnMap(board.columns);
          return {
            id: board.id,
            name: board.name,
            columns: board.columns,
            columnMap,
          };
        });

        const validatable: ResolvedLeafTask[] = [];
        const skipped: Array<ResolvedLeafTask & { skipReason: string }> = [];

        for (const item of leafMap.values()) {
          const boardCtx = boardContexts.find((b) => b.id === item.boardId);

          const isReview =
            (boardCtx?.columnMap.review && item.boardColumnId === boardCtx.columnMap.review) ||
            /review|revisión|to\s*review/.test((item.columnName ?? "").toLowerCase());

          const isValidating =
            params.includeValidating &&
            ((boardCtx?.columnMap.validating && item.boardColumnId === boardCtx.columnMap.validating) ||
              /validat/.test((item.columnName ?? "").toLowerCase()));

          if (isReview || isValidating) {
            validatable.push(item);
          } else {
            skipped.push({
              ...item,
              skipReason: `Column '${item.columnName}' is not Reviewing${params.includeValidating ? " or Validating" : ""}`,
            });
          }
        }

        const parentIds = new Set<string>();
        for (const item of leafMap.values()) {
          if (item.parentId) parentIds.add(item.parentId);
        }

        const parentItems = [];
        for (const parentId of parentIds) {
          const parent = await getWorkItemById(parentId, organizationId);
          if (!parent) continue;
          const children = await getWorkItemHierarchy(organizationId, parentId);
          const childrenInReview = children.filter((c) => {
            const bc = boardContexts.find((b) => b.id === c.boardId);
            return bc?.columnMap.review && c.boardColumnId === bc.columnMap.review;
          }).length;
          const childrenInRelease = children.filter((c) => {
            const bc = boardContexts.find((b) => b.id === c.boardId);
            return bc?.columnMap.release && c.boardColumnId === bc.columnMap.release;
          }).length;
          parentItems.push({
            id: parent.id,
            taskId: parent.taskId,
            title: parent.title,
            type: parent.type,
            totalChildren: children.length,
            childrenInReview,
            childrenInRelease,
          });
        }

        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(
                {
                  project: project
                    ? { id: project.id, name: project.name }
                    : null,
                  tasks: {
                    validatable,
                    skipped,
                  },
                  boardContext: boardContexts,
                  parentItems,
                },
                null,
                2
              ),
            },
          ],
        };
      } catch (error) {
        return {
          content: [{ type: "text" as const, text: `Error building validate context: ${error instanceof Error ? error.message : String(error)}` }],
          isError: true,
        };
      }
    }
  );

  server.tool(
    "get_record_video_context",
    "Get full context for generating a walkthrough video script: work item details, parent context, siblings, project info, walkthrough metadata, and preview URL.",
    {
      workItemId: z.string().min(1).describe("Work item identifier (UUID or taskId like MC-123)"),
    },
    async (params, extra) => {
      try {
        const organizationId = getOrganizationIdFromExtra(extra);
        if (!organizationId) {
          return { content: [{ type: "text" as const, text: "Error: could not resolve organizationId from API key" }], isError: true };
        }

        const projectId = getProjectIdFromExtra(extra);
        const isUuid = UUID_REGEX.test(params.workItemId);

        const item = isUuid
          ? await getWorkItemById(params.workItemId, organizationId)
          : (await getWorkItemsByTaskIds(organizationId, [params.workItemId]))[0] ?? null;

        if (!item) {
          return {
            content: [{ type: "text" as const, text: `Error: work item '${params.workItemId}' not found` }],
            isError: true,
          };
        }
        if (projectId && item.projectId !== projectId) {
          return {
            content: [{ type: "text" as const, text: `Error: work item '${params.workItemId}' is outside current project context` }],
            isError: true,
          };
        }

        const metadata = (item.metadata as Record<string, unknown>) ?? {};

        // Gather parent, siblings, project, and board in parallel
        const [parentItem, siblingsData, projectData, boardData] = await Promise.all([
          item.parentId ? getWorkItemById(item.parentId, organizationId) : null,
          item.parentId
            ? getWorkItems(organizationId, { page: 1, limit: 50, offset: 0 }, { parentId: item.parentId })
                .then((r) => r.items.filter((i) => i.id !== item.id))
            : Promise.resolve([]),
          item.projectId ? getProjectById(organizationId, item.projectId) : null,
          getAllBoards(organizationId).then((boards) => boards.find((b) => b.id === item.boardId) ?? null),
        ]);

        const walkthroughRaw = metadata.walkthrough as Record<string, unknown> | undefined;

        const result = {
          workItem: {
            id: item.id,
            taskId: item.taskId,
            title: item.title,
            description: item.description,
            type: item.type,
            priority: item.priority,
            definitionOfDone: (metadata.definitionOfDone as string) ?? null,
            previewUrl: (metadata.previewUrl as string) ?? null,
          },
          parent: parentItem
            ? {
                id: parentItem.id,
                taskId: parentItem.taskId,
                title: parentItem.title,
                type: parentItem.type,
                description: parentItem.description,
              }
            : null,
          siblings: siblingsData.map((s) => ({
            id: s.id,
            taskId: s.taskId,
            title: s.title,
            type: s.type,
            priority: s.priority,
            columnName: s.columnName,
          })),
          project: projectData
            ? {
                id: projectData.id,
                name: projectData.name,
                description: projectData.description,
                techStack: (projectData.techStack as string[]) ?? [],
              }
            : null,
          board: boardData
            ? {
                id: boardData.id,
                name: boardData.name,
                columns: boardData.columns,
                columnMap: buildColumnMap(boardData.columns),
              }
            : null,
          walkthrough: walkthroughRaw ?? null,
          recordings: Array.isArray(walkthroughRaw?.recordings) ? walkthroughRaw.recordings : [],
        };

        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(result, null, 2),
            },
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Error building record video context: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
          isError: true,
        };
      }
    }
  );

  server.tool(
    "get_document_context",
    "Resolve identifiers into leaf tasks in the Release column, include metadata (documentation, testResults, changedFiles), board mappings, parent summaries, and existing project documents.",
    {
      ids: z.array(z.string().min(1)).min(1).describe("List of task IDs/UUIDs to document"),
      projectId: z.string().uuid().optional().describe("Project ID (defaults to MCP session project)"),
    },
    async (params, extra) => {
      try {
        const organizationId = getOrganizationIdFromExtra(extra);
        if (!organizationId) {
          return { content: [{ type: "text" as const, text: "Error: could not resolve organizationId from API key" }], isError: true };
        }

        const projectId = params.projectId ?? getProjectIdFromExtra(extra);
        if (!projectId) {
          return {
            content: [{ type: "text" as const, text: "Error: projectId is required" }],
            isError: true,
          };
        }

        const project = await getProjectById(organizationId, projectId);
        const uniqueInputIds = Array.from(new Set(params.ids.map((id) => id.trim()).filter(Boolean)));

        const uuidIds = uniqueInputIds.filter((id) => UUID_REGEX.test(id));
        const taskIds = uniqueInputIds.filter((id) => !UUID_REGEX.test(id));
        const [byUuid, byTaskId] = await Promise.all([
          getWorkItemsByIds(organizationId, uuidIds),
          getWorkItemsByTaskIds(organizationId, taskIds),
        ]);
        const baseItems = [...byUuid, ...byTaskId].filter((item) => item.projectId === projectId);
        const byTaskIdMap = new Map(byTaskId.filter((item) => item.taskId).map((item) => [item.taskId as string, item]));

        const leafMap = new Map<string, ResolvedLeafTask>();
        for (const rawId of uniqueInputIds) {
          const base = UUID_REGEX.test(rawId)
            ? baseItems.find((item) => item.id === rawId)
            : byTaskIdMap.get(rawId);
          if (!base) continue;
          await resolveToLeafTasks(organizationId, base, rawId, 3, new Set<string>(), leafMap);
        }

        const boards = await getAllBoards(organizationId);

        const boardContexts = boards.map((board) => {
          const columnMap = buildColumnMap(board.columns);
          return {
            id: board.id,
            name: board.name,
            columns: board.columns,
            columnMap,
          };
        });

        const documentable: Array<ResolvedLeafTask & { documentation?: unknown; testResults?: unknown; changedFiles?: unknown; walkthroughRecordings?: unknown; hasCompletedWalkthrough?: boolean }> = [];
        const skipped: Array<ResolvedLeafTask & { skipReason: string }> = [];

        for (const item of leafMap.values()) {
          const boardCtx = boardContexts.find((b) => b.id === item.boardId);

          const isRelease =
            (boardCtx?.columnMap.release && item.boardColumnId === boardCtx.columnMap.release) ||
            /release/.test((item.columnName ?? "").toLowerCase());

          if (isRelease) {
            const meta = (item.metadata as Record<string, unknown>) ?? {};
            const walkthroughMeta = meta.walkthrough as Record<string, unknown> | undefined;
            const recordings = Array.isArray(walkthroughMeta?.recordings) ? walkthroughMeta.recordings : [];
            const completedRecordings = recordings.filter(
              (r: Record<string, unknown>) => r.attachmentUrl
            ).map((r: Record<string, unknown>) => ({
              attachmentUrl: r.attachmentUrl,
              viewport: r.viewport ?? "desktop",
              duration: r.duration ?? null,
            }));
            const hasCompletedWalkthrough = walkthroughMeta?.status === "completed" && completedRecordings.length > 0;

            documentable.push({
              ...item,
              documentation: meta.documentation ?? undefined,
              testResults: meta.testResults ?? undefined,
              changedFiles: meta.changedFiles ?? undefined,
              walkthroughRecordings: completedRecordings.length > 0 ? completedRecordings : undefined,
              hasCompletedWalkthrough,
            });
          } else {
            skipped.push({
              ...item,
              skipReason: `Column '${item.columnName}' is not Release`,
            });
          }
        }

        // Parent item summaries
        const parentIds = new Set<string>();
        for (const item of leafMap.values()) {
          if (item.parentId) parentIds.add(item.parentId);
        }

        const parentItems = [];
        for (const parentId of parentIds) {
          const parent = await getWorkItemById(parentId, organizationId);
          if (!parent) continue;
          const children = await getWorkItemHierarchy(organizationId, parentId);
          const childrenInRelease = children.filter((c) => {
            const bc = boardContexts.find((b) => b.id === c.boardId);
            return bc?.columnMap.release && c.boardColumnId === bc.columnMap.release;
          }).length;
          const childrenInDone = children.filter((c) => {
            const bc = boardContexts.find((b) => b.id === c.boardId);
            return bc?.columnMap.done && c.boardColumnId === bc.columnMap.done;
          }).length;
          parentItems.push({
            id: parent.id,
            taskId: parent.taskId,
            title: parent.title,
            type: parent.type,
            totalChildren: children.length,
            childrenInRelease,
            childrenInDone,
          });
        }

        // Existing project documents for context
        const existingDocsResult = await getDocuments(organizationId, { page: 1, limit: 50, offset: 0 }, { projectId });
        const existingDocs = existingDocsResult.items.map((doc: Record<string, unknown>) => ({
          id: doc.id,
          title: doc.title,
          categoryName: doc.categoryName ?? null,
        }));

        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(
                {
                  project: project
                    ? { id: project.id, name: project.name }
                    : null,
                  tasks: {
                    documentable,
                    skipped,
                  },
                  boardContext: boardContexts,
                  parentItems,
                  existingDocs,
                },
                null,
                2
              ),
            },
          ],
        };
      } catch (error) {
        return {
          content: [{ type: "text" as const, text: `Error building document context: ${error instanceof Error ? error.message : String(error)}` }],
          isError: true,
        };
      }
    }
  );
};

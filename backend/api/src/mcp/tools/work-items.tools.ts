import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import path from "node:path";
import { unlink } from "node:fs/promises";
import {
  getWorkItems,
  getWorkItemById,
  createWorkItem,
  updateWorkItem,
  deleteWorkItem,
  moveWorkItem,
  bulkMoveWorkItems,
  getDescendantLeafIds,
  setWorkItemAiProcessing,
  createAiSession,
  getAiSessionsByWorkItemId,
  getAiSessionsSummaryByWorkItemId,
  getWorkItemEventsByWorkItemId,
  createAttachment,
  getAllBoards,
  db,
  boardColumns,
  eq,
  and,
  isParentType,
  createEntityComment,
  getEntityComments,
  createDocument,
  linkDocumentToWorkItem,
} from "@almirant/database";
import { getActivityLogger } from "@almirant/shared";
import { saveGeneratedPrompt, addWorkItemToSession, linkWorkItemToSeed } from "@almirant/database";
import { wsConnectionManager } from "../../shared/ws/ws-connection-manager";
import { gatherWorkItemContext, buildEnrichedPromptInput } from "../../domains/project-management/work-items/services/prompt-context-service";
import { formatText, isAiConfigured } from "../../domains/ai/shared/services/ai-service";
import { calculateCostUsd, type AiProvider } from "../../domains/billing/quota/services/ai-model-pricing";
import { uploadBufferToS3, generateAttachmentKey, isS3Configured } from "../../shared/services/s3-service";
import { writeLocalAttachment } from "../../shared/services/local-attachments";
import { getProjectIdFromExtra, getWorkspaceIdFromExtra, getManagedByAgentFromExtra, getUserIdFromExtra, getPlanningSessionIdFromExtra, getPlanningMetadataFromExtra, getJobIdFromExtra } from "../setup";
import { quotaService } from "../../domains/billing/quota/services/quota-service-instance";
import { propagateProviderToParent } from "../../domains/connections/services/propagate-provider";
import {
  notifyReviewCompleted,
  notifyWorkItemAssigned,
  notifyWorkItemDone,
  notifyWorkItemMoved,
  notifyUserActions,
} from "../../domains/integrations/telegram/services/telegram/notifications";
import {
  emailNotifyReviewCompleted,
  emailNotifyWorkItemAssigned,
  emailNotifyWorkItemDone,
  emailNotifyWorkItemMoved,
  emailNotifyUserActions,
} from "../../shared/services/email/notifications";
import { logger } from "@almirant/config";
import { refreshResourceForecastForAffectedBlocks } from "../../domains/agents/services/resource-forecast";
import { runWithCompleteAiTaskRetry } from "./complete-ai-task-retry";

type ManagedByAgent = "claude-code" | "codex";

const MAX_AUTOMATED_DOD_INCOMPLETE_COUNT = 3;

const definitionOfDoneCriterionResultSchema = z.object({
  text: z.string().min(1).describe("Exact criterion text copied from metadata.definitionOfDone, without the markdown checkbox marker"),
  status: z.enum(["pass", "fail", "unknown"]).describe("Criterion evaluation result. Only 'pass' marks the original DoD checkbox as checked."),
});

type DefinitionOfDoneCriterionResult = z.infer<typeof definitionOfDoneCriterionResultSchema>;

const DEFINITION_OF_DONE_CHECKBOX_LINE_REGEX = /^(\s*(?:[-*+]|\d+\.)\s+\[)(?: |x|X)(\]\s+)(.*)$/;

const normalizeDefinitionOfDoneCriterion = (text: string): string =>
  text.replace(/\s+/g, " ").trim().toLowerCase();

const updateDefinitionOfDoneChecklist = (
  definitionOfDone: unknown,
  result: "approved" | "incompleted",
  criteria: DefinitionOfDoneCriterionResult[] | undefined,
): string | undefined => {
  if (typeof definitionOfDone !== "string" || definitionOfDone.trim().length === 0) {
    return undefined;
  }

  const lines = definitionOfDone.split(/\r?\n/);
  const hasChecklistItems = lines.some((line) => DEFINITION_OF_DONE_CHECKBOX_LINE_REGEX.test(line));
  if (!hasChecklistItems) {
    return undefined;
  }

  const criterionStatusByText = new Map<string, DefinitionOfDoneCriterionResult["status"]>();
  for (const criterion of criteria ?? []) {
    const normalized = normalizeDefinitionOfDoneCriterion(criterion.text);
    if (normalized.length > 0) {
      criterionStatusByText.set(normalized, criterion.status);
    }
  }

  const hasExplicitCriteria = criterionStatusByText.size > 0;
  let changed = false;

  const nextLines = lines.map((line) => {
    const match = line.match(DEFINITION_OF_DONE_CHECKBOX_LINE_REGEX);
    if (!match) return line;

    const prefix = match[1] ?? "";
    const suffix = match[2] ?? "";
    const text = match[3] ?? "";
    const normalized = normalizeDefinitionOfDoneCriterion(text);
    const status = criterionStatusByText.get(normalized);
    const checked = hasExplicitCriteria
      ? status === "pass"
      : result === "approved";
    const nextLine = `${prefix}${checked ? "x" : " "}${suffix}${text}`;

    if (nextLine !== line) {
      changed = true;
    }

    return nextLine;
  });

  return changed ? nextLines.join("\n") : undefined;
};

const getMetadataNumber = (
  metadata: Record<string, unknown>,
  key: string,
): number => {
  const value = metadata[key];
  if (typeof value === "number" && Number.isFinite(value)) return Math.max(0, Math.floor(value));
  if (typeof value === "string" && value.trim().length > 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? Math.max(0, Math.floor(parsed)) : 0;
  }
  return 0;
};

const refreshForecastsForChangedWorkItems = async (
  workspaceId: string,
  workItemIds: Array<string | null | undefined>,
): Promise<void> => {
  await refreshResourceForecastForAffectedBlocks(
    workspaceId,
    workItemIds.filter((id): id is string => typeof id === "string" && id.trim().length > 0),
  );
};

type ColumnRole = "backlog" | "todo" | "in_progress" | "review" | "testing" | "needs_fix" | "validating" | "release" | "to_document" | "done" | "other";

const inferRoleFromName = (name: string): ColumnRole => {
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

const getManagedByFromProvider = (provider?: string): ManagedByAgent | undefined => {
  if (provider === "openai") return "codex";
  if (provider === "zai") return "codex";
  if (provider === "zai") return "codex";
  if (provider === "anthropic") return "claude-code";
  return undefined;
};

const inferAiProvider = (model: string, provider?: string): AiProvider => {
  const normalizedProvider = provider?.trim().toLowerCase().replace(/_/g, "-");
  const normalizedModel = model.trim().toLowerCase();
  const allowedProviders = new Set<AiProvider>([
    "openai",
    "anthropic",
    "google",
    "zai",
  ]);

  if (normalizedProvider) {
    if (normalizedProvider === "zai" && normalizedModel.startsWith("glm-")) {
      return "zai";
    }
    if (allowedProviders.has(normalizedProvider as AiProvider)) {
      return normalizedProvider as AiProvider;
    }
  }

  if (normalizedModel.startsWith("glm-")) return "zai";
  if (normalizedModel.startsWith("claude-")) return "anthropic";
  if (
    normalizedModel.startsWith("gpt-") ||
    normalizedModel.startsWith("o1") ||
    normalizedModel.startsWith("o3") ||
    normalizedModel.startsWith("o4")
  ) {
    return "openai";
  }

  return "openai";
};

const recordQuotaUsage = async (
  workspaceId: string,
  provider: AiProvider,
  totalTokens: number,
  estimatedCost: number,
): Promise<void> => {
  try {
    await quotaService.recordUsage(
      workspaceId,
      provider,
      totalTokens,
      estimatedCost,
    );
  } catch (error) {
    logger.warn(
      { workspaceId, provider, totalTokens, estimatedCost, error },
      "work-items.tools: failed to record quota usage"
    );
  }
};

const inferMimeTypeFromName = (fileName: string): string => {
  const lower = fileName.toLowerCase();
  if (lower.endsWith(".png")) return "image/png";
  if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "image/jpeg";
  if (lower.endsWith(".webp")) return "image/webp";
  if (lower.endsWith(".webm")) return "video/webm";
  if (lower.endsWith(".mp4")) return "video/mp4";
  if (lower.endsWith(".pdf")) return "application/pdf";
  return "application/octet-stream";
};

const isAllowedAttachmentPath = (filePath: string): boolean => {
  const resolved = path.resolve(filePath);
  if (resolved.startsWith("/tmp/")) return true;

  // Allow repo-relative paths (useful when Playwright MCP writes into `.playwright-mcp/`).
  const cwd = path.resolve(process.cwd()) + path.sep;
  if (resolved.startsWith(cwd)) return true;

  return false;
};

const mergeManagedByMetadata = (
  existingMetadata: Record<string, unknown> | undefined,
  incomingMetadata: Record<string, unknown> | undefined,
  managedBy?: ManagedByAgent
): Record<string, unknown> | undefined => {
  if (!existingMetadata && !incomingMetadata && !managedBy) return undefined;

  const next = {
    ...(existingMetadata ?? {}),
    ...(incomingMetadata ?? {}),
  };

  const incomingProvider = typeof incomingMetadata?.aiProvider === "string"
    ? incomingMetadata.aiProvider
    : undefined;
  const providerManagedBy = getManagedByFromProvider(incomingProvider);

  if (providerManagedBy) {
    next.managedBy = providerManagedBy;
    next.managedByAgents = [providerManagedBy];
    return next;
  }

  const agents = new Set<ManagedByAgent>();
  const collect = (metadata?: Record<string, unknown>) => {
    if (!metadata) return;
    const value = metadata.managedBy;
    const list = metadata.managedByAgents;

    if (value === "claude-code" || value === "codex") agents.add(value);
    if (Array.isArray(list)) {
      for (const item of list) {
        if (item === "claude-code" || item === "codex") agents.add(item);
      }
    } else if (list === "claude-code" || list === "codex") {
      agents.add(list);
    }
  };

  collect(existingMetadata);
  collect(incomingMetadata);
  if (managedBy) agents.add(managedBy);

  if (agents.size > 0) {
    next.managedByAgents = Array.from(agents);
    next.managedBy = managedBy ?? next.managedBy;
  }

  return next;
};

/**
 * Links a newly created work item to its planning context (session + seeds).
 * Failures are logged as warnings but never block the work item creation.
 */
const linkPlanningContext = async (
  workspaceId: string,
  workItemId: string,
  planningSessionId: string | undefined,
  fromSeedIds: string[] | undefined,
  userId: string | undefined
): Promise<void> => {
  if (planningSessionId) {
    try {
      await addWorkItemToSession(planningSessionId, workItemId);
    } catch (error) {
      logger.warn(
        { planningSessionId, workItemId, error },
        "MCP: failed to link work item to planning session"
      );
    }
  }

  if (fromSeedIds && fromSeedIds.length > 0) {
    for (const seedId of fromSeedIds) {
      try {
        await linkWorkItemToSeed(
          workspaceId,
          seedId,
          workItemId,
          "promoted_to",
          userId ?? null,
          { triggeredBy: "system" }
        );
      } catch (error) {
        logger.warn(
          { seedId, workItemId, workspaceId, error },
          "MCP: failed to link work item to seed"
        );
      }
    }
  }
};

export const registerWorkItemsTools = (server: McpServer) => {
  // -------------------------------------------------------
  // list_work_items - List work items with pagination and filters
  // -------------------------------------------------------
  server.tool(
    "list_work_items",
    "List work items (tasks, stories, features, epics) with optional pagination and filters",
    {
      page: z.number().int().min(1).optional().describe("Page number (default: 1)"),
      limit: z.number().int().min(1).max(100).optional().describe("Items per page (default: 50, max: 100)"),
      search: z.string().optional().describe("Search by title or description"),
      projectId: z.string().uuid().optional().describe("Filter by project ID"),
      boardId: z.string().uuid().optional().describe("Filter by board ID"),
      boardColumnId: z.string().uuid().optional().describe("Filter by board column ID (e.g. Backlog, In Progress, Reviewing)"),
      parentId: z.string().uuid().optional().describe("Filter by parent work item ID (e.g. get children of a feature)"),
      type: z.enum(["epic", "feature", "story", "task", "idea"]).optional().describe("Filter by work item type"),
      priority: z.enum(["low", "medium", "high", "urgent"]).optional().describe("Filter by priority level"),
      assignee: z.string().optional().describe("Filter by assignee"),
    },
    async (params, extra) => {
      try {
        const workspaceId = getWorkspaceIdFromExtra(extra);
        if (!workspaceId) {
          return { content: [{ type: "text" as const, text: "Error: could not resolve workspaceId from API key" }], isError: true };
        }

        const page = params.page ?? 1;
        const limit = params.limit ?? 50;
        const offset = (page - 1) * limit;

        // Use explicit projectId param, or fall back to MCP session's default projectId
        const defaultProjectId = getProjectIdFromExtra(extra);
        const filters = {
          search: params.search,
          projectId: params.projectId ?? defaultProjectId,
          boardId: params.boardId,
          boardColumnId: params.boardColumnId,
          parentId: params.parentId,
          type: params.type,
          priority: params.priority,
          assignee: params.assignee,
        };

        const { items, total } = await getWorkItems(workspaceId, { page, limit, offset }, filters);

        const result = {
          workItems: items,
          pagination: {
            page,
            limit,
            total,
            totalPages: Math.ceil(total / limit),
          },
        };

        return {
          content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
        };
      } catch (error) {
        return {
          content: [{ type: "text" as const, text: `Error listing work items: ${error instanceof Error ? error.message : String(error)}` }],
          isError: true,
        };
      }
    }
  );

  // -------------------------------------------------------
  // get_work_item - Get a single work item by ID
  // -------------------------------------------------------
  server.tool(
    "get_work_item",
    "Get a single work item by ID including related board, column, parent, creator, assignees, and tags data when available.",
    {
      id: z.string().uuid().describe("Work item ID to retrieve"),
    },
    async (params, extra) => {
      try {
        const workspaceId = getWorkspaceIdFromExtra(extra);
        if (!workspaceId) {
          return { content: [{ type: "text" as const, text: "Error: could not resolve workspaceId from API key" }], isError: true };
        }

        const workItem = await getWorkItemById(params.id, workspaceId);
        if (!workItem) {
          return {
            content: [{ type: "text" as const, text: `Error: Work item with ID '${params.id}' not found` }],
            isError: true,
          };
        }

        return {
          content: [{ type: "text" as const, text: JSON.stringify(workItem, null, 2) }],
        };
      } catch (error) {
        return {
          content: [{ type: "text" as const, text: `Error retrieving work item: ${error instanceof Error ? error.message : String(error)}` }],
          isError: true,
        };
      }
    }
  );

  // -------------------------------------------------------
  // create_work_item - Create a new work item
  // -------------------------------------------------------
  server.tool(
    "create_work_item",
    "Create a new work item (task, story, feature, or epic) on a board. Note: boards may restrict allowed types via board.allowedTypes (null/empty means allow all).",
    {
      title: z.string().min(1).describe("Work item title (required)"),
      description: z.string().optional().describe("Detailed description"),
      type: z.enum(["epic", "feature", "story", "task", "idea"]).describe("Work item type (required)"),
      priority: z.enum(["low", "medium", "high", "urgent"]).optional().describe("Priority level"),
      boardId: z.string().uuid().describe("Board ID where this item belongs (required)"),
      boardColumnId: z.string().uuid().optional().describe("Board column ID for initial placement (required for task/idea, omit for parent types)"),
      projectId: z.string().uuid().optional().describe("Project ID (uses MCP session default if not provided)"),
      assignee: z.string().optional().describe("Assignee name or identifier"),
      parentId: z.string().uuid().optional().describe("Parent work item ID (for sub-items)"),
      metadata: z.record(z.string(), z.any()).optional().describe("Arbitrary metadata (e.g. { definitionOfDone: '...' })"),
    },
    async (params, extra) => {
      try {
        const workspaceId = getWorkspaceIdFromExtra(extra);
        if (!workspaceId) {
          return { content: [{ type: "text" as const, text: "Error: could not resolve workspaceId from API key" }], isError: true };
        }

        const managedBy = getManagedByAgentFromExtra(extra);
        const planningSessionId = getPlanningSessionIdFromExtra(extra);
        const { planningModel, planningProvider, fromSeedIds } = getPlanningMetadataFromExtra(extra);
        const userId = getUserIdFromExtra(extra);
        // Use explicit projectId param, or fall back to MCP session's default projectId
        const defaultProjectId = getProjectIdFromExtra(extra);
        const projectId = params.projectId ?? defaultProjectId;

        if (!projectId) {
          return {
            content: [{ type: "text" as const, text: "Error: projectId is required. Either provide it as a parameter or configure it in your MCP connection URL (?projectId=<uuid>)." }],
            isError: true,
          };
        }

        const planningMeta: Record<string, unknown> = {};
        if (planningSessionId) planningMeta.planningSessionId = planningSessionId;
        if (planningModel) planningMeta.planningModel = planningModel;
        if (planningProvider) planningMeta.planningProvider = planningProvider;
        if (fromSeedIds && fromSeedIds.length > 0) planningMeta.fromSeedIds = fromSeedIds;

        const item = await createWorkItem(workspaceId, {
          title: params.title,
          description: params.description,
          type: params.type,
          priority: params.priority,
          boardId: params.boardId,
          boardColumnId: params.boardColumnId ?? null,
          projectId,
          assignee: params.assignee,
          parentId: params.parentId,
          createdByUserId: userId,
          metadata: mergeManagedByMetadata(undefined, { ...planningMeta, ...params.metadata }, managedBy),
        });

        await linkPlanningContext(workspaceId, item.id, planningSessionId, fromSeedIds, userId);
        await refreshForecastsForChangedWorkItems(workspaceId, [item.id]);

        wsConnectionManager.broadcastToWorkspace(workspaceId, {
          type: "work-item:created",
          payload: {
            workItemId: item.id,
            boardId: params.boardId,
            title: item.title,
            taskId: item.taskId ?? undefined,
          },
        });

        return {
          content: [{ type: "text" as const, text: JSON.stringify(item, null, 2) }],
        };
      } catch (error) {
        return {
          content: [{ type: "text" as const, text: `Error creating work item: ${error instanceof Error ? error.message : String(error)}` }],
          isError: true,
        };
      }
    }
  );

  const resolveBoardAndDefaultColumn = async (
    workspaceId: string,
    projectId: string,
    preferredColumnName: string
  ) => {
    const boards = await getAllBoards(workspaceId);
    if (boards.length === 0) {
      throw new Error(`No boards found for project '${projectId}'`);
    }

    // Safe: length > 0 is checked above
    const board = boards[0]!; // Single board per project after migration

    const preferred = board.columns.find(
      (c) => c.name.toLowerCase() === preferredColumnName.toLowerCase()
    );
    const backlog = board.columns.find((c) => c.role === "backlog")
      ?? board.columns.find((c) => c.name.toLowerCase() === "backlog");
    const fallback = preferred ?? backlog ?? board.columns[0];
    if (!fallback) {
      throw new Error(`Board '${board.name}' has no columns`);
    }

    return { boardId: board.id, boardColumnId: fallback.id };
  };

  // -------------------------------------------------------
  // create_task / create_story / create_feature / create_epic
  // Typed MCP tools that force type + default board selection.
  // -------------------------------------------------------
  server.tool(
    "create_task",
    "Create a task in the project's board. Forces type=task. Uses default column (prefers \"Backlog\").",
    {
      title: z.string().min(1).describe("Task title (required)"),
      description: z.string().optional().describe("Detailed description"),
      priority: z.enum(["low", "medium", "high", "urgent"]).optional().describe("Priority level"),
      parentId: z.string().uuid().optional().describe("Optional parent work item ID"),
      metadata: z.record(z.string(), z.any()).optional().describe("Arbitrary metadata"),
    },
    async (params, extra) => {
      try {
        const workspaceId = getWorkspaceIdFromExtra(extra);
        if (!workspaceId) {
          return { content: [{ type: "text" as const, text: "Error: could not resolve workspaceId from API key" }], isError: true };
        }

        const managedBy = getManagedByAgentFromExtra(extra);
        const planningSessionId = getPlanningSessionIdFromExtra(extra);
        const { planningModel, planningProvider, fromSeedIds } = getPlanningMetadataFromExtra(extra);
        const userId = getUserIdFromExtra(extra);
        const projectId = getProjectIdFromExtra(extra);
        if (!projectId) {
          return {
            content: [{ type: "text" as const, text: "Error: projectId is required. Configure it in your MCP connection URL (?projectId=<uuid>)." }],
            isError: true,
          };
        }

        const planningMeta: Record<string, unknown> = {};
        if (planningSessionId) planningMeta.planningSessionId = planningSessionId;
        if (planningModel) planningMeta.planningModel = planningModel;
        if (planningProvider) planningMeta.planningProvider = planningProvider;
        if (fromSeedIds && fromSeedIds.length > 0) planningMeta.fromSeedIds = fromSeedIds;

        const { boardId, boardColumnId } = await resolveBoardAndDefaultColumn(workspaceId, projectId, "Backlog");
        const item = await createWorkItem(workspaceId, {
          title: params.title,
          description: params.description,
          type: "task",
          priority: params.priority,
          boardId,
          boardColumnId,
          projectId,
          parentId: params.parentId,
          createdByUserId: userId,
          metadata: mergeManagedByMetadata(undefined, { ...planningMeta, ...params.metadata }, managedBy),
        });

        await linkPlanningContext(workspaceId, item.id, planningSessionId, fromSeedIds, userId);
        await refreshForecastsForChangedWorkItems(workspaceId, [item.id]);

        wsConnectionManager.broadcastToWorkspace(workspaceId, {
          type: "work-item:created",
          payload: { workItemId: item.id, boardId, title: item.title, taskId: item.taskId ?? undefined },
        });

        return { content: [{ type: "text" as const, text: JSON.stringify(item, null, 2) }] };
      } catch (error) {
        return {
          content: [{ type: "text" as const, text: `Error creating task: ${error instanceof Error ? error.message : String(error)}` }],
          isError: true,
        };
      }
    }
  );

  server.tool(
    "create_story",
    "Create a story in the project's board. Forces type=story. Parent types have no column (status derived from children).",
    {
      title: z.string().min(1).describe("Story title (required)"),
      description: z.string().optional().describe("Detailed description"),
      priority: z.enum(["low", "medium", "high", "urgent"]).optional().describe("Priority level"),
      parentId: z.string().uuid().optional().describe("Optional parent feature ID"),
      metadata: z.record(z.string(), z.any()).optional().describe("Arbitrary metadata"),
    },
    async (params, extra) => {
      try {
        const workspaceId = getWorkspaceIdFromExtra(extra);
        if (!workspaceId) {
          return { content: [{ type: "text" as const, text: "Error: could not resolve workspaceId from API key" }], isError: true };
        }

        const managedBy = getManagedByAgentFromExtra(extra);
        const planningSessionId = getPlanningSessionIdFromExtra(extra);
        const { planningModel, planningProvider, fromSeedIds } = getPlanningMetadataFromExtra(extra);
        const userId = getUserIdFromExtra(extra);
        const projectId = getProjectIdFromExtra(extra);
        if (!projectId) {
          return {
            content: [{ type: "text" as const, text: "Error: projectId is required. Configure it in your MCP connection URL (?projectId=<uuid>)." }],
            isError: true,
          };
        }

        const planningMeta: Record<string, unknown> = {};
        if (planningSessionId) planningMeta.planningSessionId = planningSessionId;
        if (planningModel) planningMeta.planningModel = planningModel;
        if (planningProvider) planningMeta.planningProvider = planningProvider;
        if (fromSeedIds && fromSeedIds.length > 0) planningMeta.fromSeedIds = fromSeedIds;

        const { boardId } = await resolveBoardAndDefaultColumn(workspaceId, projectId, "Backlog");
        const item = await createWorkItem(workspaceId, {
          title: params.title,
          description: params.description,
          type: "story",
          priority: params.priority,
          boardId,
          boardColumnId: null,
          projectId,
          parentId: params.parentId,
          createdByUserId: userId,
          metadata: mergeManagedByMetadata(undefined, { ...planningMeta, ...params.metadata }, managedBy),
        });

        await linkPlanningContext(workspaceId, item.id, planningSessionId, fromSeedIds, userId);
        await refreshForecastsForChangedWorkItems(workspaceId, [item.id]);

        wsConnectionManager.broadcastToWorkspace(workspaceId, {
          type: "work-item:created",
          payload: { workItemId: item.id, boardId, title: item.title, taskId: item.taskId ?? undefined },
        });

        return { content: [{ type: "text" as const, text: JSON.stringify(item, null, 2) }] };
      } catch (error) {
        return {
          content: [{ type: "text" as const, text: `Error creating story: ${error instanceof Error ? error.message : String(error)}` }],
          isError: true,
        };
      }
    }
  );

  server.tool(
    "create_feature",
    "Create a feature in the project's board. Forces type=feature. Parent types have no column (status derived from children).",
    {
      title: z.string().min(1).describe("Feature title (required)"),
      description: z.string().optional().describe("Detailed description"),
      priority: z.enum(["low", "medium", "high", "urgent"]).optional().describe("Priority level"),
      parentId: z.string().uuid().optional().describe("Optional parent epic ID"),
      metadata: z.record(z.string(), z.any()).optional().describe("Arbitrary metadata"),
    },
    async (params, extra) => {
      try {
        const workspaceId = getWorkspaceIdFromExtra(extra);
        if (!workspaceId) {
          return { content: [{ type: "text" as const, text: "Error: could not resolve workspaceId from API key" }], isError: true };
        }

        const managedBy = getManagedByAgentFromExtra(extra);
        const planningSessionId = getPlanningSessionIdFromExtra(extra);
        const { planningModel, planningProvider, fromSeedIds } = getPlanningMetadataFromExtra(extra);
        const userId = getUserIdFromExtra(extra);
        const projectId = getProjectIdFromExtra(extra);
        if (!projectId) {
          return {
            content: [{ type: "text" as const, text: "Error: projectId is required. Configure it in your MCP connection URL (?projectId=<uuid>)." }],
            isError: true,
          };
        }

        const planningMeta: Record<string, unknown> = {};
        if (planningSessionId) planningMeta.planningSessionId = planningSessionId;
        if (planningModel) planningMeta.planningModel = planningModel;
        if (planningProvider) planningMeta.planningProvider = planningProvider;
        if (fromSeedIds && fromSeedIds.length > 0) planningMeta.fromSeedIds = fromSeedIds;

        const { boardId } = await resolveBoardAndDefaultColumn(workspaceId, projectId, "Backlog");
        const item = await createWorkItem(workspaceId, {
          title: params.title,
          description: params.description,
          type: "feature",
          priority: params.priority,
          boardId,
          boardColumnId: null,
          projectId,
          parentId: params.parentId,
          createdByUserId: userId,
          metadata: mergeManagedByMetadata(undefined, { ...planningMeta, ...params.metadata }, managedBy),
        });

        await linkPlanningContext(workspaceId, item.id, planningSessionId, fromSeedIds, userId);
        await refreshForecastsForChangedWorkItems(workspaceId, [item.id]);

        wsConnectionManager.broadcastToWorkspace(workspaceId, {
          type: "work-item:created",
          payload: { workItemId: item.id, boardId, title: item.title, taskId: item.taskId ?? undefined },
        });

        return { content: [{ type: "text" as const, text: JSON.stringify(item, null, 2) }] };
      } catch (error) {
        return {
          content: [{ type: "text" as const, text: `Error creating feature: ${error instanceof Error ? error.message : String(error)}` }],
          isError: true,
        };
      }
    }
  );

  server.tool(
    "create_epic",
    "Create an epic in the project's board. Forces type=epic. Parent types have no column (status derived from children).",
    {
      title: z.string().min(1).describe("Epic title (required)"),
      description: z.string().optional().describe("Detailed description"),
      priority: z.enum(["low", "medium", "high", "urgent"]).optional().describe("Priority level"),
      metadata: z.record(z.string(), z.any()).optional().describe("Arbitrary metadata"),
    },
    async (params, extra) => {
      try {
        const workspaceId = getWorkspaceIdFromExtra(extra);
        if (!workspaceId) {
          return { content: [{ type: "text" as const, text: "Error: could not resolve workspaceId from API key" }], isError: true };
        }

        const managedBy = getManagedByAgentFromExtra(extra);
        const planningSessionId = getPlanningSessionIdFromExtra(extra);
        const { planningModel, planningProvider, fromSeedIds } = getPlanningMetadataFromExtra(extra);
        const userId = getUserIdFromExtra(extra);
        const projectId = getProjectIdFromExtra(extra);
        if (!projectId) {
          return {
            content: [{ type: "text" as const, text: "Error: projectId is required. Configure it in your MCP connection URL (?projectId=<uuid>)." }],
            isError: true,
          };
        }

        const planningMeta: Record<string, unknown> = {};
        if (planningSessionId) planningMeta.planningSessionId = planningSessionId;
        if (planningModel) planningMeta.planningModel = planningModel;
        if (planningProvider) planningMeta.planningProvider = planningProvider;
        if (fromSeedIds && fromSeedIds.length > 0) planningMeta.fromSeedIds = fromSeedIds;

        const { boardId } = await resolveBoardAndDefaultColumn(workspaceId, projectId, "Backlog");
        const item = await createWorkItem(workspaceId, {
          title: params.title,
          description: params.description,
          type: "epic",
          priority: params.priority,
          boardId,
          boardColumnId: null,
          projectId,
          createdByUserId: userId,
          metadata: mergeManagedByMetadata(undefined, { ...planningMeta, ...params.metadata }, managedBy),
        });

        await linkPlanningContext(workspaceId, item.id, planningSessionId, fromSeedIds, userId);
        await refreshForecastsForChangedWorkItems(workspaceId, [item.id]);

        wsConnectionManager.broadcastToWorkspace(workspaceId, {
          type: "work-item:created",
          payload: { workItemId: item.id, boardId, title: item.title, taskId: item.taskId ?? undefined },
        });

        return { content: [{ type: "text" as const, text: JSON.stringify(item, null, 2) }] };
      } catch (error) {
        return {
          content: [{ type: "text" as const, text: `Error creating epic: ${error instanceof Error ? error.message : String(error)}` }],
          isError: true,
        };
      }
    }
  );

  // -------------------------------------------------------
  // update_work_item - Update an existing work item
  // -------------------------------------------------------
  server.tool(
    "update_work_item",
    "Update an existing work item's fields. Only provided fields will be updated.",
    {
      id: z.string().uuid().describe("Work item ID to update"),
      title: z.string().min(1).optional().describe("Updated title"),
      description: z.string().optional().describe("Updated description"),
      type: z.enum(["epic", "feature", "story", "task", "idea"]).optional().describe("Updated type"),
      priority: z.enum(["low", "medium", "high", "urgent"]).optional().describe("Updated priority"),
      assignee: z.string().optional().describe("Updated assignee"),
      boardColumnId: z.string().uuid().optional().describe("Move to a different board column by ID"),
      parentId: z.string().uuid().nullable().optional().describe("Set or clear parent work item (null to clear)"),
      metadata: z.record(z.string(), z.any()).optional().describe("Arbitrary metadata to merge into existing metadata (e.g. { definitionOfDone: '...' })"),
    },
    async (params, extra) => {
      try {
        const workspaceId = getWorkspaceIdFromExtra(extra);
        if (!workspaceId) {
          return { content: [{ type: "text" as const, text: "Error: could not resolve workspaceId from API key" }], isError: true };
        }

        const { id, metadata: newMetadata, boardColumnId, ...updateFields } = params;
        const managedBy = getManagedByAgentFromExtra(extra);
        const before = await getWorkItemById(id, workspaceId);

        if (!before) {
          return {
            content: [{ type: "text" as const, text: `Error: Work item with ID '${id}' not found` }],
            isError: true,
          };
        }

        // If boardColumnId provided, move the item to that column first
        if (boardColumnId) {
          // Validate column exists
          const [column] = await db
            .select({ id: boardColumns.id })
            .from(boardColumns)
            .where(eq(boardColumns.id, boardColumnId))
            .limit(1);

          if (!column) {
            return {
              content: [{ type: "text" as const, text: `Error: Board column with ID '${boardColumnId}' not found` }],
              isError: true,
            };
          }

          const moved = await moveWorkItem(id, boardColumnId, 0);
          if (!moved) {
            return {
              content: [{ type: "text" as const, text: `Error: Work item with ID '${id}' not found` }],
              isError: true,
            };
          }
        }

        // Build update data for remaining fields
        const updateData: Record<string, unknown> = { ...updateFields };

        // Merge metadata when metadata is provided or the MCP client identifies as an AI agent
        if (newMetadata || managedBy) {
          const existingMetadata = (before.metadata as Record<string, unknown>) ?? {};
          updateData.metadata = mergeManagedByMetadata(existingMetadata, newMetadata, managedBy);
        }

        // Only call updateWorkItem if there are fields to update beyond boardColumnId
        const hasFieldsToUpdate = Object.keys(updateData).length > 0;
        if (hasFieldsToUpdate) {
          const item = await updateWorkItem(workspaceId, id, updateData);
          if (!item) {
            return {
              content: [{ type: "text" as const, text: `Error: Work item with ID '${id}' not found` }],
              isError: true,
            };
          }
        }

        // Return the final state of the work item
        const result = await getWorkItemById(id, workspaceId);
        if (!result) {
          return {
            content: [{ type: "text" as const, text: `Error: Work item with ID '${id}' not found` }],
            isError: true,
          };
        }

        await refreshForecastsForChangedWorkItems(workspaceId, [
          id,
          before.parentId,
          result.parentId,
        ]);

        // Telegram & email notifications (best-effort; never block tool response)
        if (before.boardColumnId !== result.boardColumnId) {
          notifyWorkItemMoved({
            workItemId: id,
            fromColumnName: before.columnName ?? "",
            toColumnName: result.columnName ?? "",
          });
          emailNotifyWorkItemMoved({
            workItemId: id,
            fromColumnName: before.columnName ?? "",
            toColumnName: result.columnName ?? "",
          });

          if (/done|hecho|completed/i.test(result.columnName ?? "")) {
            notifyWorkItemDone({ workItemId: id });
            emailNotifyWorkItemDone({ workItemId: id });
          }
        }

        if (before.assignee !== result.assignee && result.assignee) {
          notifyWorkItemAssigned({ workItemId: id, assignee: result.assignee });
          emailNotifyWorkItemAssigned({ workItemId: id, assignee: result.assignee });
        }

        const beforeUserActions = (before.metadata as Record<string, unknown> | null)?.userActions;
        const afterUserActions = (result.metadata as Record<string, unknown> | null)?.userActions;
        if (typeof afterUserActions === "string") {
          const next = afterUserActions.trim();
          const prev = typeof beforeUserActions === "string" ? beforeUserActions.trim() : "";
          if (next && next !== prev) {
            notifyUserActions({ workItemId: id, userActions: next });
            emailNotifyUserActions({ workItemId: id, userActions: next });
          }
        }

        wsConnectionManager.broadcastToWorkspace(workspaceId, {
          type: "work-item:updated",
          payload: {
            workItemId: id,
            boardId: result.boardId ?? undefined,
            changes: { ...updateFields, ...(boardColumnId ? { boardColumnId } : {}), ...(newMetadata ? { metadata: newMetadata } : {}) },
          },
        });

        return {
          content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
        };
      } catch (error) {
        return {
          content: [{ type: "text" as const, text: `Error updating work item: ${error instanceof Error ? error.message : String(error)}` }],
          isError: true,
        };
      }
    }
  );

  // -------------------------------------------------------
  // delete_work_item - Delete a work item
  // -------------------------------------------------------
  server.tool(
    "delete_work_item",
    "Permanently delete a work item by ID",
    {
      id: z.string().uuid().describe("Work item ID to delete"),
    },
    async (params, extra) => {
      try {
        const workspaceId = getWorkspaceIdFromExtra(extra);
        if (!workspaceId) {
          return { content: [{ type: "text" as const, text: "Error: could not resolve workspaceId from API key" }], isError: true };
        }

        // Fetch before deleting to get boardId for the broadcast
        const existing = await getWorkItemById(params.id, workspaceId);

        const deleted = await deleteWorkItem(workspaceId, params.id);

        if (!deleted) {
          return {
            content: [{ type: "text" as const, text: `Error: Work item with ID '${params.id}' not found` }],
            isError: true,
          };
        }

        await refreshForecastsForChangedWorkItems(workspaceId, [existing?.parentId]);

        wsConnectionManager.broadcastToWorkspace(workspaceId, {
          type: "work-item:deleted",
          payload: {
            workItemId: params.id,
            boardId: existing?.boardId ?? undefined,
          },
        });

        return {
          content: [{ type: "text" as const, text: JSON.stringify({ deleted: true, id: params.id }, null, 2) }],
        };
      } catch (error) {
        return {
          content: [{ type: "text" as const, text: `Error deleting work item: ${error instanceof Error ? error.message : String(error)}` }],
          isError: true,
        };
      }
    }
  );

  // -------------------------------------------------------
  // generate_work_item_prompt - Generate enriched prompt with project context
  // -------------------------------------------------------
  server.tool(
    "generate_work_item_prompt",
    "Generate an implementation prompt for a work item, enriched with project context (tech stack, repositories, sibling tasks, board workflow). The prompt is generated by AI and saved to the work item's metadata.",
    {
      id: z.string().uuid().describe("Work item ID to generate a prompt for"),
    },
    async (params, extra) => {
      try {
        const workspaceId = getWorkspaceIdFromExtra(extra);
        if (!workspaceId) {
          return { content: [{ type: "text" as const, text: "Error: could not resolve workspaceId from API key" }], isError: true };
        }

        if (!isAiConfigured()) {
          return {
            content: [{ type: "text" as const, text: "Error: AI service is not configured. Set OPENAI_API_KEY environment variable." }],
            isError: true,
          };
        }

        const context = await gatherWorkItemContext(params.id, workspaceId);
        if (!context) {
          return {
            content: [{ type: "text" as const, text: `Error: Work item with ID '${params.id}' not found` }],
            isError: true,
          };
        }

        const enrichedInput = buildEnrichedPromptInput(context);
        const generatedPrompt = await formatText(enrichedInput, "prompt");

        const saved = await saveGeneratedPrompt(workspaceId, params.id, generatedPrompt);

        if (saved) {
          wsConnectionManager.broadcastToWorkspace(workspaceId, {
            type: "work-item:updated",
            payload: {
              workItemId: params.id,
              changes: { generatedPrompt },
            },
          });
        }

        const result = {
          prompt: generatedPrompt,
          context: {
            workItemId: context.workItem.id,
            taskId: context.workItem.taskId,
            title: context.workItem.title,
            type: context.workItem.type,
            projectName: context.project?.name ?? null,
            siblingsCount: context.siblings.length,
            hasParent: !!context.parent,
          },
          savedToDb: saved,
        };

        return {
          content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
        };
      } catch (error) {
        return {
          content: [{ type: "text" as const, text: `Error generating prompt: ${error instanceof Error ? error.message : String(error)}` }],
          isError: true,
        };
      }
    }
  );

  // -------------------------------------------------------
  // get_work_item_prompt - Retrieve stored generated prompt
  // -------------------------------------------------------
  server.tool(
    "get_work_item_prompt",
    "Retrieve the generated prompt stored in a work item's metadata. Returns the prompt text, context about the work item, and generation timestamp. Returns an error if no prompt has been generated yet.",
    {
      id: z.string().uuid().describe("Work item ID to retrieve the prompt from"),
    },
    async (params, extra) => {
      try {
        const workspaceId = getWorkspaceIdFromExtra(extra);
        if (!workspaceId) {
          return { content: [{ type: "text" as const, text: "Error: could not resolve workspaceId from API key" }], isError: true };
        }

        const workItem = await getWorkItemById(params.id, workspaceId);

        if (!workItem) {
          return {
            content: [{ type: "text" as const, text: `Error: Work item with ID '${params.id}' not found` }],
            isError: true,
          };
        }

        const metadata = workItem.metadata as Record<string, unknown> | null;
        const generatedPrompt = metadata?.generatedPrompt;

        if (!generatedPrompt) {
          return {
            content: [{ type: "text" as const, text: `Error: No generated prompt found for work item '${params.id}'` }],
            isError: true,
          };
        }

        const result = {
          prompt: generatedPrompt,
          context: {
            workItemId: workItem.id,
            taskId: workItem.taskId,
            title: workItem.title,
            type: workItem.type,
          },
          generatedAt: metadata?.promptGeneratedAt ?? null,
        };

        return {
          content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
        };
      } catch (error) {
        return {
          content: [{ type: "text" as const, text: `Error retrieving prompt: ${error instanceof Error ? error.message : String(error)}` }],
          isError: true,
        };
      }
    }
  );

  // -------------------------------------------------------
  // move_work_item - Move a work item to a different board column
  // -------------------------------------------------------
  server.tool(
    "move_work_item",
    "Move a work item to a different board column (e.g. Backlog → In Progress → Reviewing → Validating → Release → Done). For leaf items (task, idea), moves directly. For parent items (epic, feature, story), cascades the move to all descendant leaf tasks.",
    {
      workItemId: z.string().uuid().describe("The ID of the work item to move"),
      boardColumnId: z.string().uuid().describe("The ID of the target board column"),
      setAiProcessing: z.boolean().optional().describe("When true, force isAiProcessing=true regardless of target column. Useful for marking tasks as AI-managed before implementation starts."),
      aiProvider: z.string().optional().describe("AI provider identifier (e.g. 'openai', 'anthropic'). When combined with setAiProcessing=true, automatically sets metadata for provider icon display (aiReserved, aiReservationProvider, aiProvider, managedBy)."),
    },
    async (params, extra) => {
      try {
        const workspaceId = getWorkspaceIdFromExtra(extra);
        if (!workspaceId) {
          return { content: [{ type: "text" as const, text: "Error: could not resolve workspaceId from API key" }], isError: true };
        }

        // Validate work item exists
        const workItem = await getWorkItemById(params.workItemId, workspaceId);
        if (!workItem) {
          return {
            content: [{ type: "text" as const, text: `Error: Work item with ID '${params.workItemId}' not found` }],
            isError: true,
          };
        }

        // Validate board column exists
        const [column] = await db
          .select({ id: boardColumns.id, name: boardColumns.name, isDone: boardColumns.isDone, role: boardColumns.role })
          .from(boardColumns)
          .where(eq(boardColumns.id, params.boardColumnId))
          .limit(1);

        if (!column) {
          return {
            content: [{ type: "text" as const, text: `Error: Board column with ID '${params.boardColumnId}' not found` }],
            isError: true,
          };
        }

        // Parent-type items (epic/feature/story): cascade move to all descendant leaf tasks
        if (isParentType(workItem.type)) {
          const leafIds = await getDescendantLeafIds(params.workItemId);
          if (leafIds.length === 0) {
            return {
              content: [{ type: "text" as const, text: `Error: No descendant tasks found for ${workItem.type} "${workItem.taskId ?? params.workItemId}"` }],
              isError: true,
            };
          }

          const success = await bulkMoveWorkItems(workspaceId, leafIds, params.boardColumnId);
          if (!success) {
            return {
              content: [{ type: "text" as const, text: `Error: Failed to cascade move descendant tasks to column '${column.name}'` }],
              isError: true,
            };
          }

          for (const leafId of leafIds) {
            wsConnectionManager.broadcastToWorkspace(workspaceId, {
              type: "work-item:updated",
              payload: {
                workItemId: leafId,
                changes: { boardColumnId: params.boardColumnId },
              },
            });
          }

          // Broadcast parent update so UI refreshes virtual column
          wsConnectionManager.broadcastToWorkspace(workspaceId, {
            type: "work-item:updated",
            payload: {
              workItemId: params.workItemId,
              boardId: workItem.boardId,
              changes: { boardColumnId: params.boardColumnId },
            },
          });

          const updatedParent = await getWorkItemById(params.workItemId, workspaceId);
          return {
            content: [{ type: "text" as const, text: JSON.stringify({ ...updatedParent, cascadedLeafCount: leafIds.length }, null, 2) }],
          };
        }

        // Move to position 0 (top of the column)
        const mcpUserId = getUserIdFromExtra(extra);
        const success = await moveWorkItem(params.workItemId, params.boardColumnId, 0, {
          triggeredBy: "mcp",
          triggeredByUserId: mcpUserId ?? undefined,
          provenance: { source: "mcp", requestedByUserId: mcpUserId ?? undefined },
        });

        if (!success) {
          return {
            content: [{ type: "text" as const, text: `Error: Failed to move work item '${params.workItemId}' to column '${column.name}'` }],
            isError: true,
          };
        }

        // Fetch updated work item
        const updated = await getWorkItemById(params.workItemId, workspaceId);

        // Toggle AI processing flag for MCP-driven moves.
        // Start when moving into In Progress, stop when moving into Reviewing/Validating/Release/Done.
        const inferredRole = (column.role && column.role !== "other")
          ? column.role
          : inferRoleFromName(column.name ?? "");
        const isInProgress = inferredRole === "in_progress";
        const shouldClearAiProcessing = inferredRole === "review"
          || inferredRole === "testing"
          || inferredRole === "release"
          || inferredRole === "to_document"
          || inferredRole === "done"
          || column.isDone === true;

        if (params.setAiProcessing === true) {
          await setWorkItemAiProcessing(workspaceId, params.workItemId, true);

          // Auto-set provider metadata for icon display when aiProvider is specified
          if (params.aiProvider) {
            const inferredManagedBy = getManagedByFromProvider(params.aiProvider);
            const existingMeta = (updated?.metadata as Record<string, unknown> | undefined) ?? {};
            const providerMeta: Record<string, unknown> = {
              ...existingMeta,
              aiProvider: params.aiProvider,
              aiReserved: true,
              aiReservationProvider: params.aiProvider,
            };
            const merged = mergeManagedByMetadata(existingMeta, providerMeta, inferredManagedBy);
            if (merged) {
              await updateWorkItem(workspaceId, params.workItemId, { metadata: merged });
              void propagateProviderToParent(workspaceId, params.workItemId, merged);
            }
          }
        } else if (params.setAiProcessing === false) {
          await setWorkItemAiProcessing(workspaceId, params.workItemId, false);
          const existingMeta = (updated?.metadata as Record<string, unknown> | undefined) ?? {};
          await updateWorkItem(workspaceId, params.workItemId, {
            metadata: {
              ...existingMeta,
              aiReserved: false,
              aiReservationProvider: null,
            },
          });
        } else if (isInProgress) {
          await setWorkItemAiProcessing(workspaceId, params.workItemId, true);
        } else if (shouldClearAiProcessing) {
          await setWorkItemAiProcessing(workspaceId, params.workItemId, false);
        }

        if (updated && workItem.boardColumnId !== updated.boardColumnId) {
          notifyWorkItemMoved({
            workItemId: params.workItemId,
            fromColumnName: workItem.columnName ?? "",
            toColumnName: updated.columnName ?? "",
          });
          emailNotifyWorkItemMoved({
            workItemId: params.workItemId,
            fromColumnName: workItem.columnName ?? "",
            toColumnName: updated.columnName ?? "",
          });

          if (/done|hecho|completed/i.test(updated.columnName ?? "")) {
            notifyWorkItemDone({ workItemId: params.workItemId });
            emailNotifyWorkItemDone({ workItemId: params.workItemId });
          }
        }

        wsConnectionManager.broadcastToWorkspace(workspaceId, {
          type: "work-item:updated",
          payload: {
            workItemId: params.workItemId,
            boardId: updated?.boardId ?? undefined,
            changes: { boardColumnId: params.boardColumnId },
          },
        });

        return {
          content: [{ type: "text" as const, text: JSON.stringify(updated, null, 2) }],
        };
      } catch (error) {
        return {
          content: [{ type: "text" as const, text: `Error moving work item: ${error instanceof Error ? error.message : String(error)}` }],
          isError: true,
        };
      }
    }
  );

  // -------------------------------------------------------
  // complete_review - Complete a code review and move the work item accordingly
  // -------------------------------------------------------
  server.tool(
    "complete_review",
    "Complete a code review for a work item. If the review passes, the item is moved to the Validating column. If it fails, the item is moved back to In Progress. Review metadata is stored on the work item.",
    {
      workItemId: z.string().uuid().describe("The work item ID being reviewed"),
      result: z.enum(["pass", "fail"]).describe("Review result: 'pass' moves to Validating, 'fail' moves back to In Progress"),
      summary: z.string().describe("Summary of the review"),
      issues: z.array(z.string()).optional().describe("List of issues found (relevant when result is 'fail')"),
      reviewedFiles: z.array(z.string()).optional().describe("List of files that were reviewed"),
    },
    async (params, extra) => {
      try {
        const workspaceId = getWorkspaceIdFromExtra(extra);
        if (!workspaceId) {
          return { content: [{ type: "text" as const, text: "Error: could not resolve workspaceId from API key" }], isError: true };
        }

        // Fetch the work item
        const workItem = await getWorkItemById(params.workItemId, workspaceId);
        if (!workItem) {
          return {
            content: [{ type: "text" as const, text: `Error: Work item with ID '${params.workItemId}' not found` }],
            isError: true,
          };
        }

        if (!workItem.boardId) {
          return {
            content: [{ type: "text" as const, text: `Error: Work item '${params.workItemId}' is not associated with a board` }],
            isError: true,
          };
        }

        // Get all columns for the board
        const columns = await db
          .select({ id: boardColumns.id, name: boardColumns.name, role: boardColumns.role })
          .from(boardColumns)
          .where(eq(boardColumns.boardId, workItem.boardId));

        // Find the target column based on review result
        let targetColumn: { id: string; name: string; role: string | null } | undefined;

        if (params.result === "pass") {
          targetColumn = columns.find((col) => col.role === "validating")
            ?? columns.find((col) => col.role === "testing")
            ?? columns.find((col) => /validat|testing|test|qa/i.test(col.name));
        } else {
          targetColumn = columns.find((col) => col.role === "in_progress")
            ?? columns.find((col) => /progress|doing|en progreso/i.test(col.name));
        }

        if (!targetColumn) {
          const expected = params.result === "pass"
            ? "Validating"
            : "In Progress/Doing/En Progreso";
          return {
            content: [{ type: "text" as const, text: `Error: Could not find a '${expected}' column on the board. Available columns: ${columns.map((c) => c.name).join(", ")}` }],
            isError: true,
          };
        }

        // Move the work item to the target column (position 0 = top)
        const moved = await moveWorkItem(params.workItemId, targetColumn.id, 0);
        if (!moved) {
          return {
            content: [{ type: "text" as const, text: `Error: Failed to move work item '${params.workItemId}' to column '${targetColumn.name}'` }],
            isError: true,
          };
        }

        // Merge review metadata into existing metadata
        const existingMetadata = (workItem.metadata as Record<string, unknown>) ?? {};
        const reviewMetadata: Record<string, unknown> = {
          ...existingMetadata,
          lastReviewResult: params.result,
          lastReviewSummary: params.summary,
          lastReviewAt: new Date().toISOString(),
          lastReviewIssues: params.issues ?? [],
          aiReserved: false,
          aiReservationProvider: null,
        };

        if (params.reviewedFiles) {
          reviewMetadata.lastReviewedFiles = params.reviewedFiles;
        }

        await setWorkItemAiProcessing(workspaceId, params.workItemId, false);
        await updateWorkItem(workspaceId, params.workItemId, { metadata: reviewMetadata });

        // Record agent action event
        const reviewUserId = getUserIdFromExtra(extra);
        getActivityLogger().log({
          actorUserId: (reviewUserId ?? null) as string,
          workspaceId,
          action: 'ai_session',
          resourceType: 'work_item',
          resourceId: params.workItemId,
          metadata: {
            triggeredBy: 'claude-code',
            action: 'review' as const,
            model: 'unknown',
            result: params.result === 'pass' ? 'pass' : 'fail',
            diagnosis: params.result === 'fail' ? params.summary : undefined,
            source: 'mcp',
            ...(reviewUserId ? { requestedByUserId: reviewUserId } : {}),
          },
        });

        // Fetch the final updated work item
        const updated = await getWorkItemById(params.workItemId, workspaceId);

        notifyReviewCompleted({
          workItemId: params.workItemId,
          result: params.result,
          summary: params.summary,
        });
        emailNotifyReviewCompleted({
          workItemId: params.workItemId,
          result: params.result,
          summary: params.summary,
        });

        // Broadcast WebSocket event
        wsConnectionManager.broadcastToWorkspace(workspaceId, {
          type: "work-item:review-completed",
          payload: {
            workItemId: params.workItemId,
            boardId: workItem.boardId,
            taskId: workItem.taskId ?? undefined,
            title: workItem.title,
            result: params.result,
            summary: params.summary,
            targetColumn: targetColumn.name,
          },
        });

        return {
          content: [{ type: "text" as const, text: JSON.stringify(updated, null, 2) }],
        };
      } catch (error) {
        return {
          content: [{ type: "text" as const, text: `Error completing review: ${error instanceof Error ? error.message : String(error)}` }],
          isError: true,
        };
      }
    }
  );

  // -------------------------------------------------------
  // complete_definition_of_done_review - Mark DoD review state
  // -------------------------------------------------------
  server.tool(
    "complete_definition_of_done_review",
    "Atomically complete a Definition of Done review for a work item or parent block. Approved items stay in Review with metadata.dod_approved=true. Incomplete items are moved back to Backlog, metadata.dod_incompleted=true, and the report is stored as metadata plus a visible comment when a user context is available.",
    {
      workItemId: z.string().uuid().describe("The work item ID being checked against its Definition of Done"),
      result: z.enum(["approved", "incompleted"]).describe("DoD result: 'approved' sets dod_approved; 'incompleted' sets dod_incompleted and moves back to Backlog"),
      report: z.string().min(1).describe("Markdown report explaining what was checked and, when incomplete, what must be fixed"),
      backlogColumnId: z.string().uuid().optional().describe("Optional Backlog column ID. When omitted, the tool auto-detects the board's Backlog column."),
      definitionOfDoneCriteria: z.array(definitionOfDoneCriterionResultSchema).optional().describe("Optional criteria statuses for the primary work item. Text must exactly match each metadata.definitionOfDone checklist item without the checkbox marker. The tool updates existing markdown checkboxes: pass -> [x], fail/unknown/omitted -> [ ]."),
      definitionOfDoneCriteriaByWorkItemId: z.record(z.string(), z.array(definitionOfDoneCriterionResultSchema)).optional().describe("Optional criteria statuses keyed by work item ID for parent block reviews. Use this to update child work item DoD checkboxes while completing the parent review once."),
    },
    async (params, extra) => {
      try {
        const workspaceId = getWorkspaceIdFromExtra(extra);
        if (!workspaceId) {
          return { content: [{ type: "text" as const, text: "Error: could not resolve workspaceId from API key" }], isError: true };
        }

        const workItem = await getWorkItemById(params.workItemId, workspaceId);
        if (!workItem) {
          return {
            content: [{ type: "text" as const, text: `Error: Work item '${params.workItemId}' not found` }],
            isError: true,
          };
        }

        if (!workItem.boardId) {
          return {
            content: [{ type: "text" as const, text: `Error: Work item '${params.workItemId}' is not associated with a board` }],
            isError: true,
          };
        }

        const isParentBlock = isParentType(workItem.type);
        const descendantLeafIds = isParentBlock
          ? await getDescendantLeafIds(params.workItemId)
          : [];

        if (isParentBlock && descendantLeafIds.length === 0) {
          return {
            content: [{ type: "text" as const, text: `Error: Parent work item '${params.workItemId}' has no descendant leaf tasks to complete DoD review for` }],
            isError: true,
          };
        }

        // Decide whether the primary work item needs human intervention BEFORE
        // moving anything. If the DoD has already failed
        // MAX_AUTOMATED_DOD_INCOMPLETE_COUNT times in a row, no automated agent
        // will pick this up again — moving it to Backlog would just bury it
        // under tasks that are still actively being worked on. Keep it in
        // Review (its current column) so the human reviewer actually finds it.
        const primaryExistingMeta = (workItem.metadata as Record<string, unknown> | undefined) ?? {};
        const primaryPreviousDodIncompleteCount = getMetadataNumber(primaryExistingMeta, "dod_incompleted_count");
        const primaryNextDodIncompleteCount = params.result === "incompleted"
          ? primaryPreviousDodIncompleteCount + 1
          : primaryPreviousDodIncompleteCount;
        const primaryHumanReviewRequired = params.result === "incompleted"
          ? primaryNextDodIncompleteCount > MAX_AUTOMATED_DOD_INCOMPLETE_COUNT
          : false;

        let targetColumn: { id: string; name: string } | null = null;

        if (params.result === "incompleted" && !primaryHumanReviewRequired) {
          if (params.backlogColumnId) {
            const [column] = await db
              .select({ id: boardColumns.id, name: boardColumns.name, boardId: boardColumns.boardId })
              .from(boardColumns)
              .where(and(eq(boardColumns.id, params.backlogColumnId), eq(boardColumns.boardId, workItem.boardId)))
              .limit(1);

            if (!column) {
              return {
                content: [{ type: "text" as const, text: `Error: Backlog column '${params.backlogColumnId}' was not found on board '${workItem.boardId}'` }],
                isError: true,
              };
            }

            targetColumn = column;
          } else {
            const columns = await db
              .select({ id: boardColumns.id, name: boardColumns.name, role: boardColumns.role })
              .from(boardColumns)
              .where(eq(boardColumns.boardId, workItem.boardId));

            targetColumn = columns.find((col) => col.role === "backlog")
              ?? columns.find((col) => col.name.toLowerCase().includes("backlog"))
              ?? null;

            if (!targetColumn) {
              return {
                content: [{ type: "text" as const, text: `Error: Could not find a Backlog column on the board. Available columns: ${columns.map((c) => c.name).join(", ")}` }],
                isError: true,
              };
            }
          }

          const moved = isParentBlock
            ? await bulkMoveWorkItems(workspaceId, descendantLeafIds, targetColumn.id)
            : await moveWorkItem(params.workItemId, targetColumn.id, 0);
          if (!moved) {
            return {
              content: [{ type: "text" as const, text: `Error: Failed to move ${isParentBlock ? "descendant tasks for parent work item" : "work item"} '${params.workItemId}' to '${targetColumn.name}'` }],
              isError: true,
            };
          }
        }

        const now = new Date().toISOString();
        const affectedWorkItemIds = isParentBlock
          ? [params.workItemId, ...descendantLeafIds]
          : [params.workItemId];
        let primaryDodIncompleteCount: number | undefined;
        let primaryDodHumanReviewRequired: boolean | undefined;
        const definitionOfDoneChecklistUpdatedIds: string[] = [];

        for (const affectedWorkItemId of affectedWorkItemIds) {
          await setWorkItemAiProcessing(workspaceId, affectedWorkItemId, false);

          const affectedWorkItem = affectedWorkItemId === params.workItemId
            ? workItem
            : await getWorkItemById(affectedWorkItemId, workspaceId);
          if (!affectedWorkItem) continue;

          const existingMeta = (affectedWorkItem.metadata as Record<string, unknown> | undefined) ?? {};
          const previousDodIncompleteCount = getMetadataNumber(existingMeta, "dod_incompleted_count");
          const nextDodIncompleteCount = params.result === "incompleted"
            ? previousDodIncompleteCount + 1
            : previousDodIncompleteCount;
          const humanReviewRequired = params.result === "incompleted"
            ? nextDodIncompleteCount > MAX_AUTOMATED_DOD_INCOMPLETE_COUNT
            : false;
          if (affectedWorkItemId === params.workItemId) {
            primaryDodIncompleteCount = nextDodIncompleteCount;
            primaryDodHumanReviewRequired = humanReviewRequired;
          }
          const updatedMeta: Record<string, unknown> = {
            ...existingMeta,
            dod_approved: params.result === "approved",
            dod_incompleted: params.result === "incompleted",
            dod_report: params.report,
            dod_reviewed_at: now,
            dod_incompleted_count: nextDodIncompleteCount,
            dod_human_review_required: humanReviewRequired,
            dod_auto_remediation_blocked: humanReviewRequired,
            aiReserved: false,
            aiReservationProvider: null,
          };

          const criteriaForWorkItem = params.definitionOfDoneCriteriaByWorkItemId?.[affectedWorkItemId]
            ?? (affectedWorkItemId === params.workItemId ? params.definitionOfDoneCriteria : undefined);
          const updatedDefinitionOfDone = updateDefinitionOfDoneChecklist(
            existingMeta.definitionOfDone,
            params.result,
            criteriaForWorkItem,
          );
          if (updatedDefinitionOfDone !== undefined) {
            updatedMeta.definitionOfDone = updatedDefinitionOfDone;
            definitionOfDoneChecklistUpdatedIds.push(affectedWorkItemId);
          }

          await updateWorkItem(workspaceId, affectedWorkItemId, { metadata: updatedMeta });
        }

        const userId = getUserIdFromExtra(extra);
        getActivityLogger().log({
          actorUserId: (userId ?? null) as string,
          workspaceId,
          action: "ai_session",
          resourceType: "work_item",
          resourceId: params.workItemId,
          metadata: {
            triggeredBy: "mcp",
            action: "definition_of_done_review" as const,
            result: params.result,
            diagnosis: params.result === "incompleted" ? params.report : undefined,
            timestamp: now,
            source: "mcp",
            ...(userId ? { requestedByUserId: userId } : {}),
          },
        });

        let commentResult: {
          created: boolean;
          id: string | null;
          error: string | null;
        } = {
          created: false,
          id: null,
          error: null,
        };

        if (params.result === "incompleted" && userId) {
          try {
            const comment = await createEntityComment(
              "work_item",
              params.workItemId,
              userId,
              `## Definition of Done incomplete\n\n${params.report}`,
            );

            commentResult = {
              created: true,
              id: comment.id,
              error: null,
            };
          } catch (commentError) {
            const message = commentError instanceof Error
              ? commentError.message
              : String(commentError);

            commentResult = {
              created: false,
              id: null,
              error: message,
            };

            logger.warn(
              {
                workspaceId,
                workItemId: params.workItemId,
                userId: userId ?? null,
                error: commentError,
              },
              "work-items.tools: DoD review completed but visible comment creation failed"
            );
          }
        }

        const updated = await getWorkItemById(params.workItemId, workspaceId);

        // Broadcast a work-item:updated event for EVERY affected work item, not
        // just the primary. For parent-block reviews the descendants get their
        // dod_* metadata rewritten in the loop above and (when incompleted)
        // moved to the backlog column, but until now they triggered no WS
        // event — so any UI listening for per-id changes (work item detail
        // pages, ID-targeted invalidations like ai:session-recorded handlers)
        // saw stale DoD state until the user manually refreshed.
        // Also fix the per-item changes: only the items that actually moved
        // get boardColumnId in their payload (parent stays in Review for
        // parent-block reviews).
        const movedWorkItemIds = new Set<string>(
          targetColumn
            ? (isParentBlock ? descendantLeafIds : [params.workItemId])
            : [],
        );
        const broadcastBoardId = updated?.boardId ?? workItem.boardId ?? undefined;
        for (const affectedId of affectedWorkItemIds) {
          wsConnectionManager.broadcastToWorkspace(workspaceId, {
            type: "work-item:updated",
            payload: {
              workItemId: affectedId,
              boardId: broadcastBoardId,
              changes: {
                metadata: true,
                isAiProcessing: false,
                ...(targetColumn && movedWorkItemIds.has(affectedId)
                  ? { boardColumnId: targetColumn.id }
                  : {}),
              },
            },
          });
        }

        if (targetColumn) {
          void Promise.resolve()
            .then(() => notifyWorkItemMoved({
              workItemId: params.workItemId,
              fromColumnName: workItem.columnName ?? "Review",
              toColumnName: targetColumn.name,
            }))
            .catch(() => {});
          void Promise.resolve()
            .then(() => emailNotifyWorkItemMoved({
              workItemId: params.workItemId,
              fromColumnName: workItem.columnName ?? "Review",
              toColumnName: targetColumn.name,
            }))
            .catch(() => {});
        }

        return {
          content: [{
            type: "text" as const,
            text: JSON.stringify({
              completed: true,
              result: params.result,
              workItemId: params.workItemId,
              flags: {
                dod_approved: params.result === "approved",
                dod_incompleted: params.result === "incompleted",
                dod_incompleted_count: primaryDodIncompleteCount,
                dod_human_review_required: primaryDodHumanReviewRequired,
              },
              affectedWorkItemIds,
              definitionOfDoneChecklistUpdatedIds,
              movedTo: targetColumn?.name ?? updated?.columnName ?? null,
              reviewedAt: now,
              comment: commentResult,
            }, null, 2),
          }],
        };
      } catch (error) {
        return {
          content: [{ type: "text" as const, text: `Error completing Definition of Done review: ${error instanceof Error ? error.message : String(error)}` }],
          isError: true,
        };
      }
    }
  );

  // -------------------------------------------------------
  // upload_work_item_attachment - Upload an attachment from a local file path (AI tooling)
  // -------------------------------------------------------
  server.tool(
    "upload_work_item_attachment",
    "Upload a work item attachment from a local file path. Intended for AI tooling (e.g. attaching Playwright screenshots).",
    {
      workItemId: z.string().uuid().describe("Work item ID to attach the file to"),
      filePath: z.string().min(1).describe("Absolute or repo-relative file path (allowed: /tmp/* or under current working dir)"),
      fileName: z.string().min(1).optional().describe("Override file name stored on the attachment (default: basename(filePath))"),
      mimeType: z.string().min(1).optional().describe("Optional MIME type (default inferred from fileName)"),
      uploadedBy: z.string().min(1).optional().describe("Optional uploader label"),
      metadata: z.record(z.string(), z.any()).optional().describe("Optional attachment metadata (e.g. { kind: 'review-screenshot', page: '/boards' })"),
      deleteAfterUpload: z.boolean().optional().describe("If true, delete filePath after successful upload (default: true)"),
    },
    async (params, extra) => {
      try {
        const workspaceId = getWorkspaceIdFromExtra(extra);
        if (!workspaceId) {
          return { content: [{ type: "text" as const, text: "Error: could not resolve workspaceId from API key" }], isError: true };
        }

        const workItem = await getWorkItemById(params.workItemId, workspaceId);
        if (!workItem) {
          return {
            content: [{ type: "text" as const, text: `Error: Work item with ID '${params.workItemId}' not found` }],
            isError: true,
          };
        }

        if (!isAllowedAttachmentPath(params.filePath)) {
          return {
            content: [{ type: "text" as const, text: "Error: filePath is not allowed. Use a path under /tmp/ or under the current working directory." }],
            isError: true,
          };
        }

        const file = Bun.file(params.filePath);
        if (!(await file.exists())) {
          return {
            content: [{ type: "text" as const, text: `Error: file not found at '${params.filePath}'` }],
            isError: true,
          };
        }

        let buffer: Buffer<ArrayBufferLike> = Buffer.from(await file.arrayBuffer() as ArrayBuffer);
        let fileName = params.fileName ?? path.basename(params.filePath);
        let mimeType = params.mimeType ?? inferMimeTypeFromName(fileName);

        const isReviewScreenshot = params.metadata?.kind === "review-screenshot";
        if (isReviewScreenshot && buffer.length > 2_000_000) {
          try {
            const sharpMod = await import("sharp");
            const sharp = sharpMod.default;

            if (mimeType === "image/png") {
              const next = await sharp(buffer)
                .png({ compressionLevel: 9, palette: true, quality: 80 })
                .toBuffer();
              if (next.length < buffer.length) buffer = next;
            }

            if (buffer.length > 2_000_000) {
              const next = await sharp(buffer)
                .jpeg({ quality: 75, mozjpeg: true })
                .toBuffer();
              buffer = next;
              mimeType = "image/jpeg";
              fileName = fileName.replace(/\.png$/i, ".jpg");
            }
          } catch {
            // Best-effort only.
          }
        }

        const key = generateAttachmentKey(params.workItemId, fileName);
        let fileUrl: string;
        const storageMetadata: Record<string, unknown> = {};

        if (isS3Configured()) {
          fileUrl = await uploadBufferToS3(buffer, key, mimeType);
          storageMetadata.storage = "s3";
          storageMetadata.key = key;
        } else {
          await writeLocalAttachment(key, buffer);
          fileUrl = `/api/work-items/${params.workItemId}/attachments/local?key=${encodeURIComponent(key)}`;
          storageMetadata.storage = "local";
          storageMetadata.key = key;
        }

        const attachment = await createAttachment(workspaceId, {
          workItemId: params.workItemId,
          fileName,
          fileUrl,
          fileSize: buffer.length,
          mimeType,
          uploadedBy: params.uploadedBy,
          metadata: { ...(params.metadata ?? {}), ...storageMetadata },
        });

        const deleteAfterUpload = params.deleteAfterUpload ?? true;
        if (deleteAfterUpload) {
          try {
            await unlink(params.filePath);
          } catch {
            // Best-effort cleanup only.
          }
        }

        return {
          content: [{ type: "text" as const, text: JSON.stringify(attachment, null, 2) }],
        };
      } catch (error) {
        return {
          content: [{ type: "text" as const, text: `Error uploading attachment: ${error instanceof Error ? error.message : String(error)}` }],
          isError: true,
        };
      }
    }
  );

  // -------------------------------------------------------
  // upload_walkthrough_video - Upload a walkthrough recording and update metadata
  // -------------------------------------------------------
  server.tool(
    "upload_walkthrough_video",
    "Upload a walkthrough video recording as an attachment and update the work item's walkthrough metadata. Generates a descriptive file name, stores the video, adds a WalkthroughRecording entry to metadata.walkthrough.recordings, and sets walkthrough status to 'completed'.",
    {
      workItemId: z.string().uuid().describe("Work item ID to attach the video to"),
      filePath: z.string().min(1).describe("Absolute path to the video file (e.g., /tmp/recording.webm)"),
      viewport: z.enum(["desktop", "mobile"]).describe("Viewport used for the recording"),
      scriptVersion: z.number().int().min(1).describe("Version number of the approved walkthrough script"),
      jobId: z.string().optional().describe("Agent job ID that triggered this recording"),
      duration: z.number().optional().describe("Video duration in seconds"),
    },
    async (params, extra) => {
      try {
        const workspaceId = getWorkspaceIdFromExtra(extra);
        if (!workspaceId) {
          return { content: [{ type: "text" as const, text: "Error: could not resolve workspaceId from API key" }], isError: true };
        }

        const workItem = await getWorkItemById(params.workItemId, workspaceId);
        if (!workItem) {
          return {
            content: [{ type: "text" as const, text: `Error: Work item with ID '${params.workItemId}' not found` }],
            isError: true,
          };
        }

        if (!isAllowedAttachmentPath(params.filePath)) {
          return {
            content: [{ type: "text" as const, text: "Error: filePath is not allowed. Use a path under /tmp/ or under the current working directory." }],
            isError: true,
          };
        }

        const file = Bun.file(params.filePath);
        if (!(await file.exists())) {
          return {
            content: [{ type: "text" as const, text: `Error: file not found at '${params.filePath}'` }],
            isError: true,
          };
        }

        const buffer = Buffer.from(await file.arrayBuffer() as ArrayBuffer);
        const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
        const fileName = `walkthrough-${params.viewport}-v${params.scriptVersion}-${timestamp}.webm`;
        const mimeType = "video/webm";

        // Upload to storage (S3 or local)
        const key = generateAttachmentKey(params.workItemId, fileName);
        let fileUrl: string;
        const storageMetadata: Record<string, unknown> = {};

        if (isS3Configured()) {
          fileUrl = await uploadBufferToS3(buffer, key, mimeType);
          storageMetadata.storage = "s3";
          storageMetadata.key = key;
        } else {
          await writeLocalAttachment(key, buffer);
          fileUrl = `/api/work-items/${params.workItemId}/attachments/local?key=${encodeURIComponent(key)}`;
          storageMetadata.storage = "local";
          storageMetadata.key = key;
        }

        // Create the attachment record
        const attachment = await createAttachment(workspaceId, {
          workItemId: params.workItemId,
          fileName,
          fileUrl,
          fileSize: buffer.length,
          mimeType,
          metadata: {
            kind: "walkthrough",
            viewport: params.viewport,
            scriptVersion: params.scriptVersion,
            jobId: params.jobId,
            duration: params.duration,
            ...storageMetadata,
          },
        });

        // Delete source file after successful upload
        try {
          await unlink(params.filePath);
        } catch {
          // Best-effort cleanup only.
        }

        // Build the WalkthroughRecording entry
        const recordingId = crypto.randomUUID();
        const recording = {
          id: recordingId,
          viewport: params.viewport,
          attachmentId: attachment.id,
          attachmentUrl: fileUrl,
          duration: params.duration,
          recordedAt: new Date().toISOString(),
          jobId: params.jobId,
        };

        // Update the work item's walkthrough metadata
        const existingMeta = (workItem.metadata as Record<string, unknown> | undefined) ?? {};
        const existingWalkthrough = (existingMeta.walkthrough as Record<string, unknown> | undefined) ?? {};
        const existingRecordings = Array.isArray(existingWalkthrough.recordings) ? existingWalkthrough.recordings : [];

        const updatedWalkthrough = {
          ...existingWalkthrough,
          status: "completed",
          completedAt: new Date().toISOString(),
          recordings: [...existingRecordings, recording],
        };

        const updatedMeta = {
          ...existingMeta,
          walkthrough: updatedWalkthrough,
        };

        await updateWorkItem(workspaceId, params.workItemId, { metadata: updatedMeta });

        const result = {
          attachmentId: attachment.id,
          fileName,
          fileUrl,
          recording,
        };

        return {
          content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
        };
      } catch (error) {
        return {
          content: [{ type: "text" as const, text: `Error uploading walkthrough video: ${error instanceof Error ? error.message : String(error)}` }],
          isError: true,
        };
      }
    }
  );

  // -------------------------------------------------------
  // get_work_item_events - Get the event history of a work item
  // -------------------------------------------------------
  server.tool(
    "get_work_item_events",
    "Get the event history (changelog) of a work item. Returns events like created, updated, moved, deleted, attachment_added, attachment_removed, ai_session, and comment. Useful for understanding what changes have been made to a work item over time.",
    {
      workItemId: z.string().uuid().describe("The work item ID to get events for"),
      eventType: z
        .enum(["created", "updated", "moved", "deleted", "attachment_added", "attachment_removed", "ai_session", "comment"])
        .optional()
        .describe("Filter by event type"),
      limit: z.number().int().min(1).max(200).optional().describe("Max number of events to return (default: 50, max: 200)"),
    },
    async (params, extra) => {
      try {
        const workspaceId = getWorkspaceIdFromExtra(extra);
        if (!workspaceId) {
          return { content: [{ type: "text" as const, text: "Error: could not resolve workspaceId from API key" }], isError: true };
        }

        // Validate work item exists
        const workItem = await getWorkItemById(params.workItemId, workspaceId);
        if (!workItem) {
          return {
            content: [{ type: "text" as const, text: `Error: Work item with ID '${params.workItemId}' not found` }],
            isError: true,
          };
        }

        const events = await getWorkItemEventsByWorkItemId(params.workItemId, {
          eventType: params.eventType,
          limit: params.limit ?? 50,
        });

        const result = {
          workItemId: params.workItemId,
          taskId: workItem.taskId,
          title: workItem.title,
          totalEvents: events.length,
          events,
        };

        return {
          content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
        };
      } catch (error) {
        return {
          content: [{ type: "text" as const, text: `Error fetching work item events: ${error instanceof Error ? error.message : String(error)}` }],
          isError: true,
        };
      }
    }
  );

  // -------------------------------------------------------
  // record_ai_session - Record AI token usage for a work item
  // -------------------------------------------------------
  server.tool(
    "record_ai_session",
    "Record an AI session's token usage and cost for a work item. Call this when finishing work on a task to track AI resource consumption.",
    {
      workItemId: z.string().uuid().describe("The work item ID this AI session is associated with"),
      model: z.string().describe("The AI model used (e.g. 'claude-opus-4-6', 'claude-sonnet-4-6')"),
      provider: z.string().optional().describe("AI provider (optional; inferred from model when omitted)"),
      inputTokens: z.number().int().min(0).describe("Total input tokens consumed"),
      outputTokens: z.number().int().min(0).describe("Total output tokens consumed"),
      totalTokens: z.number().int().min(0).describe("Total tokens (input + output)"),
      estimatedCost: z.number().min(0).optional().describe("Estimated cost in USD (optional; computed server-side when possible)"),
      durationMs: z.number().int().min(0).optional().describe("Session duration in milliseconds"),
      sessionType: z.string().optional().describe("Type of session (default: 'implement')"),
      metadata: z.record(z.string(), z.any()).optional().describe("Additional metadata (e.g. { taskId: 'MC-48', skill: 'implement' })"),
    },
    async (params, extra) => {
      try {
        const workspaceId = getWorkspaceIdFromExtra(extra);
        if (!workspaceId) {
          return { content: [{ type: "text" as const, text: "Error: could not resolve workspaceId from API key" }], isError: true };
        }

        const provider = inferAiProvider(params.model, params.provider);
        const computedCost = calculateCostUsd({
          provider,
          model: params.model,
          inputTokens: params.inputTokens,
          outputTokens: params.outputTokens,
        });
        const estimatedCost = computedCost ?? params.estimatedCost ?? 0;

        const mcpUserId = getUserIdFromExtra(extra);
        const enrichedMetadata = {
          ...(params.metadata ?? {}),
          source: "mcp",
          ...(mcpUserId ? { requestedByUserId: mcpUserId } : {}),
        };

        const session = await createAiSession(workspaceId, {
          workItemId: params.workItemId,
          model: params.model,
          provider,
          inputTokens: params.inputTokens,
          outputTokens: params.outputTokens,
          totalTokens: params.totalTokens,
          estimatedCost: String(estimatedCost),
          durationMs: params.durationMs ?? null,
          sessionType: params.sessionType ?? "implement",
          metadata: enrichedMetadata,
        });

        await recordQuotaUsage(
          workspaceId,
          provider,
          params.totalTokens,
          estimatedCost,
        );

        // Persist provider/model on the work item for correct provider icon rendering.
        const inferredManagedBy = getManagedByFromProvider(provider);
        const existing = await getWorkItemById(params.workItemId, workspaceId);
        const existingMeta = (existing?.metadata as Record<string, unknown> | undefined) ?? undefined;
        const merged = mergeManagedByMetadata(
          existingMeta,
          {
            aiProvider: provider,
            aiModel: params.model,
          },
          inferredManagedBy
        );
        if (merged) {
          await updateWorkItem(workspaceId, params.workItemId, { metadata: merged });
        }

        wsConnectionManager.broadcastToWorkspace(workspaceId, {
          type: "ai:session-recorded",
          payload: {
            workItemId: params.workItemId,
            boardId: existing?.boardId ?? null,
            taskId: existing?.taskId ?? null,
            title: existing?.title ?? null,
            model: session.model,
            provider: session.provider,
            inputTokens: session.inputTokens,
            outputTokens: session.outputTokens,
            totalTokens: session.totalTokens,
            estimatedCost: session.estimatedCost,
            durationMs: session.durationMs,
            sessionType: session.sessionType,
            metadata: (session.metadata ?? {}) as Record<string, unknown>,
            createdAt: session.createdAt instanceof Date ? session.createdAt.toISOString() : session.createdAt,
          },
        });

        // Ensure the "AI processing" flag is cleared when the session ends.
        await setWorkItemAiProcessing(workspaceId, params.workItemId, false);

        return {
          content: [{ type: "text" as const, text: JSON.stringify({ recorded: true, sessionId: session.id, workItemId: params.workItemId }, null, 2) }],
        };
      } catch (error) {
        return {
          content: [{ type: "text" as const, text: `Error recording AI session: ${error instanceof Error ? error.message : String(error)}` }],
          isError: true,
        };
      }
    }
  );

  // -------------------------------------------------------
  // complete_ai_task - Atomically finish AI work on a task
  // -------------------------------------------------------
  server.tool(
    "complete_ai_task",
    "Atomically complete AI work on a task: move to Review, clear AI processing flags, set userActions, and record the AI session with token usage. Use this single call instead of separate move_work_item + update_work_item + record_ai_session calls.",
    {
      workItemId: z.string().uuid().describe("The work item ID to complete"),
      reviewColumnId: z.string().uuid().describe("The ID of the Review column to move the task into"),
      userActions: z.string().optional().describe("Markdown bullet list of manual steps the user needs to verify. Empty string or omit if none."),
      model: z.string().describe("The AI model that was used by the subagent (e.g. 'claude-opus-4-6', 'claude-sonnet-4-6')"),
      provider: z.string().optional().describe("AI provider (optional; inferred from model when omitted)"),
      totalTokens: z.number().int().min(0).describe("Total tokens consumed (input + output + cache). Kept for backward compatibility; prefer inputTokens + outputTokens + cache tokens when available."),
      inputTokens: z.number().int().min(0).optional().describe("Actual input tokens (excluding cache). When provided alongside outputTokens, disables the 80/20 estimate."),
      outputTokens: z.number().int().min(0).optional().describe("Actual output tokens. Use alongside inputTokens to record real usage."),
      cacheReadInputTokens: z.number().int().min(0).optional().describe("Tokens read from prompt cache. Billed at ~10% of input rate on Anthropic."),
      cacheCreationInputTokens: z.number().int().min(0).optional().describe("Tokens written to prompt cache. Billed at ~125% of input rate on Anthropic."),
      durationMs: z.number().int().min(0).optional().describe("Session duration in milliseconds"),
      sessionType: z.string().optional().describe("Type of session (default: 'implement')"),
      taskId: z.string().optional().describe("Human-readable task ID for metadata (e.g. 'MC-355')"),
      codingAgent: z.enum(["codex", "claude-code", "opencode"]).optional().describe("The coding agent that executed this task (e.g. 'claude-code')"),
      aiModel: z.string().optional().describe("The AI model identifier to store on the work item column (e.g. 'claude-opus-4-6')"),
      requestedByUserId: z.string().optional().describe("The user ID who requested this implementation"),
    },
    async (params, extra) => {
      try {
        const workspaceId = getWorkspaceIdFromExtra(extra);
        if (!workspaceId) {
          return { content: [{ type: "text" as const, text: "Error: could not resolve workspaceId from API key" }], isError: true };
        }

        const provider = inferAiProvider(params.model, params.provider);

        // 1. Validate work item exists
        const workItem = await getWorkItemById(params.workItemId, workspaceId);
        if (!workItem) {
          return {
            content: [{ type: "text" as const, text: `Error: Work item '${params.workItemId}' not found` }],
            isError: true,
          };
        }

        // 2. Validate target column exists
        const [column] = await db
          .select({ id: boardColumns.id, name: boardColumns.name })
          .from(boardColumns)
          .where(eq(boardColumns.id, params.reviewColumnId))
          .limit(1);

        if (!column) {
          return {
            content: [{ type: "text" as const, text: `Error: Board column '${params.reviewColumnId}' not found` }],
            isError: true,
          };
        }

        // 3. Move to Review column (top position)
        const moveSuccess = await runWithCompleteAiTaskRetry(
          () => moveWorkItem(params.workItemId, params.reviewColumnId, 0),
          {
            maxAttempts: 3,
            onRetry: (error, attempt, nextDelayMs) => {
              logger.warn(
                { workItemId: params.workItemId, attempt, nextDelayMs, error },
                "complete_ai_task: retrying transient moveWorkItem failure",
              );
            },
          },
        );
        if (!moveSuccess) {
          return {
            content: [{ type: "text" as const, text: `Error: Failed to move work item to '${column.name}'` }],
            isError: true,
          };
        }

        // 4. Clear AI processing flag
        await setWorkItemAiProcessing(workspaceId, params.workItemId, false);

        // 5. Update metadata: clear aiReserved, set userActions, merge provider info
        const existingMeta = (workItem.metadata as Record<string, unknown> | undefined) ?? {};
        const inferredManagedBy = getManagedByFromProvider(provider);

        const updatedMeta: Record<string, unknown> = {
          ...existingMeta,
          aiReserved: false,
          aiProvider: provider,
          aiModel: params.model,
          lastValidationResult: "pass",
          lastValidationPassedAt: new Date().toISOString(),
          dod_approved: false,
          dod_incompleted: false,
          dod_human_action_required: false,
          dod_human_review_required: false,
          dod_auto_remediation_blocked: false,
          dod_external_validation_required: false,
          dod_external_validation_tools: null,
          dod_external_validation_reason: null,
        };

        if (params.userActions !== undefined) {
          updatedMeta.userActions = params.userActions;
        }

        const merged = mergeManagedByMetadata(existingMeta, updatedMeta, inferredManagedBy);
        const updateData: Parameters<typeof updateWorkItem>[2] = {};
        if (merged) updateData.metadata = merged;
        if (params.codingAgent !== undefined) updateData.codingAgent = params.codingAgent;
        if (params.aiModel !== undefined) updateData.aiModel = params.aiModel;
        if (params.requestedByUserId !== undefined) updateData.requestedByUserId = params.requestedByUserId;
        if (Object.keys(updateData).length > 0) {
          await updateWorkItem(workspaceId, params.workItemId, updateData);
        }

        // 6. Record AI session with cost calculation.
        // If the caller provided real inputTokens + outputTokens we use those
        // directly (deterministic accounting). Otherwise fall back to the legacy
        // 80/20 estimate over totalTokens — kept for backward compatibility with
        // older skill versions that only emit a single `total_tokens` figure.
        const cacheReadInputTokens = params.cacheReadInputTokens ?? 0;
        const cacheCreationInputTokens = params.cacheCreationInputTokens ?? 0;
        const hasRealSplit =
          params.inputTokens !== undefined && params.outputTokens !== undefined;
        const inputTokens = hasRealSplit
          ? params.inputTokens!
          : Math.round(params.totalTokens * 0.8);
        const outputTokens = hasRealSplit
          ? params.outputTokens!
          : params.totalTokens - inputTokens;
        const computedCost = calculateCostUsd({
          provider,
          model: params.model,
          inputTokens,
          outputTokens,
          cacheReadInputTokens,
          cacheCreationInputTokens,
        });
        const estimatedCost = computedCost ?? 0;

        const completeValidationUserId = getUserIdFromExtra(extra);
        const jobIdFromSession = getJobIdFromExtra(extra);
        const session = await createAiSession(workspaceId, {
          workItemId: params.workItemId,
          agentJobId: jobIdFromSession ?? null,
          model: params.model,
          provider,
          inputTokens,
          outputTokens,
          cacheReadInputTokens,
          cacheCreationInputTokens,
          totalTokens: params.totalTokens,
          estimatedCost: String(estimatedCost),
          durationMs: params.durationMs ?? null,
          sessionType: params.sessionType ?? "implement",
          metadata: {
            taskId: params.taskId ?? workItem.taskId ?? null,
            skill: "implement",
            tokenSplitEstimated: !hasRealSplit,
            source: "mcp",
            ...(completeValidationUserId ? { requestedByUserId: completeValidationUserId } : {}),
          },
        });

        await recordQuotaUsage(
          workspaceId,
          provider,
          params.totalTokens,
          estimatedCost,
        );

        // Record agent action event
        getActivityLogger().log({
          actorUserId: (completeValidationUserId ?? null) as string,
          workspaceId,
          action: 'ai_session',
          resourceType: 'work_item',
          resourceId: params.workItemId,
          metadata: {
            triggeredBy: 'claude-code',
            action: 'implement' as const,
            model: params.model,
            result: 'pass' as const,
            durationMs: params.durationMs,
            tokensUsed: params.totalTokens,
            source: 'mcp',
            ...(completeValidationUserId ? { requestedByUserId: completeValidationUserId } : {}),
          },
        });

        // 7. Broadcast WebSocket: work-item:updated (triggers frontend board refresh)
        // Mark `metadata: true` because step 5 rewrites every dod_* flag and
        // several other metadata fields (aiReserved, lastValidation*, etc.).
        // Without it, listeners that look at `changes` to decide whether to
        // refresh DoD-derived UI (badges, action buttons) think only the
        // column moved and keep showing stale flags.
        const updatedItem = await getWorkItemById(params.workItemId, workspaceId);
        wsConnectionManager.broadcastToWorkspace(workspaceId, {
          type: "work-item:updated",
          payload: {
            workItemId: params.workItemId,
            boardId: updatedItem?.boardId ?? workItem.boardId ?? undefined,
            changes: {
              metadata: true,
              boardColumnId: params.reviewColumnId,
              isAiProcessing: false,
            },
          },
        });

        // 8. Broadcast WebSocket: ai:session-recorded
        wsConnectionManager.broadcastToWorkspace(workspaceId, {
          type: "ai:session-recorded",
          payload: {
            workItemId: params.workItemId,
            boardId: workItem.boardId ?? null,
            taskId: workItem.taskId ?? null,
            title: workItem.title ?? null,
            model: session.model,
            provider: session.provider,
            inputTokens: session.inputTokens,
            outputTokens: session.outputTokens,
            cacheReadInputTokens: session.cacheReadInputTokens,
            cacheCreationInputTokens: session.cacheCreationInputTokens,
            totalTokens: session.totalTokens,
            estimatedCost: session.estimatedCost,
            durationMs: session.durationMs,
            sessionType: session.sessionType,
            metadata: (session.metadata ?? {}) as Record<string, unknown>,
            createdAt: session.createdAt instanceof Date ? session.createdAt.toISOString() : session.createdAt,
          },
        });

        // 9. Telegram & email notifications
        notifyWorkItemMoved({
          workItemId: params.workItemId,
          fromColumnName: workItem.columnName ?? "In Progress",
          toColumnName: column.name ?? "Review",
        }).catch(() => {});
        emailNotifyWorkItemMoved({
          workItemId: params.workItemId,
          fromColumnName: workItem.columnName ?? "In Progress",
          toColumnName: column.name ?? "Review",
        }).catch(() => {});

        if (params.userActions && params.userActions.trim().length > 0) {
          notifyUserActions({ workItemId: params.workItemId, userActions: params.userActions }).catch(() => {});
          emailNotifyUserActions({ workItemId: params.workItemId, userActions: params.userActions }).catch(() => {});
        }

        return {
          content: [{
            type: "text" as const,
            text: JSON.stringify({
              completed: true,
              workItemId: params.workItemId,
              movedTo: column.name,
              sessionId: session.id,
              estimatedCost: `$${estimatedCost.toFixed(4)}`,
              totalTokens: params.totalTokens,
            }, null, 2),
          }],
        };
      } catch (error) {
        return {
          content: [{ type: "text" as const, text: `Error completing AI task: ${error instanceof Error ? error.message : String(error)}` }],
          isError: true,
        };
      }
    }
  );

  // -------------------------------------------------------
  // get_ai_sessions - Retrieve AI session history and token usage summary for a work item
  // -------------------------------------------------------
  server.tool(
    "get_ai_sessions",
    "Retrieve all AI sessions recorded for a work item, with an optional aggregated summary of total tokens, cost, and duration. Useful for inspecting AI resource consumption on a task.",
    {
      workItemId: z.string().uuid().describe("The work item ID to retrieve AI sessions for"),
      includeSummary: z.boolean().optional().default(true).describe("Include aggregated summary (totalTokens, totalCost, sessionCount). Default: true"),
    },
    async (params, extra) => {
      try {
        const workspaceId = getWorkspaceIdFromExtra(extra);
        if (!workspaceId) {
          return { content: [{ type: "text" as const, text: "Error: could not resolve workspaceId from API key" }], isError: true };
        }

        // Validate that the work item exists
        const workItem = await getWorkItemById(params.workItemId, workspaceId);
        if (!workItem) {
          return {
            content: [{ type: "text" as const, text: `Error: Work item '${params.workItemId}' not found` }],
            isError: true,
          };
        }

        if (params.includeSummary) {
          const result = await getAiSessionsSummaryByWorkItemId(workspaceId, params.workItemId);
          return {
            content: [{
              type: "text" as const,
              text: JSON.stringify({
                workItemId: params.workItemId,
                taskId: workItem.taskId ?? null,
                title: workItem.title,
                sessions: result.sessions,
                summary: result.summary,
              }, null, 2),
            }],
          };
        }

        const sessions = await getAiSessionsByWorkItemId(workspaceId, params.workItemId);
        return {
          content: [{
            type: "text" as const,
            text: JSON.stringify({
              workItemId: params.workItemId,
              taskId: workItem.taskId ?? null,
              title: workItem.title,
              sessions,
            }, null, 2),
          }],
        };
      } catch (error) {
        return {
          content: [{ type: "text" as const, text: `Error fetching AI sessions: ${error instanceof Error ? error.message : String(error)}` }],
          isError: true,
        };
      }
    }
  );

  // -------------------------------------------------------
  // complete_validation - Atomically finish validation for a task
  // -------------------------------------------------------
  server.tool(
    "complete_validation",
    "Atomically complete validation for a task: move a passing task to its destination column (normally Release), clear AI processing flags, merge documentation and test results metadata, and record the AI session. If a legacy Validating or To Document column ID is passed, the tool auto-redirects to Release when that column exists on the board.",
    {
      workItemId: z.string().uuid().describe("The work item ID to complete validation for"),
      releaseColumnId: z.string().uuid().optional().describe("Destination column for a passing validation result. Prefer the board's Release column ID."),
      toDocumentColumnId: z.string().uuid().optional().describe("Deprecated legacy alias. If a Release column exists, the tool auto-redirects there."),
      validatingColumnId: z.string().uuid().optional().describe("Legacy alias for the destination column. If you accidentally pass the board's Validating column, the tool auto-redirects to Release when available."),
      documentation: z.object({
        summary: z.string().optional().describe("1-2 sentence summary of what was validated"),
        screenshots: z.array(z.string()).optional().describe("Attachment URLs of screenshots"),
        mermaidDiagrams: z.array(z.string()).optional().describe("Mermaid diagram strings"),
        changelogEntry: z.string().optional().describe("Changelog entry text"),
      }).optional().describe("Documentation metadata to merge into metadata.documentation"),
      testResults: z.object({
        passed: z.number().int().min(0).optional().describe("Number of tests passed"),
        failed: z.number().int().min(0).optional().describe("Number of tests failed"),
        testFiles: z.array(z.string()).optional().describe("Paths of test files committed"),
      }).optional().describe("Test results metadata to merge into metadata.testResults"),
      model: z.string().describe("The AI model used (e.g. 'claude-opus-4-6')"),
      provider: z.string().optional().describe("AI provider (optional; inferred from model when omitted)"),
      totalTokens: z.number().int().min(0).describe("Total tokens consumed (input + output)"),
      durationMs: z.number().int().min(0).optional().describe("Session duration in milliseconds"),
      taskId: z.string().optional().describe("Human-readable task ID (e.g. 'MC-355')"),
    },
    async (params, extra) => {
      try {
        const workspaceId = getWorkspaceIdFromExtra(extra);
        if (!workspaceId) {
          return { content: [{ type: "text" as const, text: "Error: could not resolve workspaceId from API key" }], isError: true };
        }

        const provider = inferAiProvider(params.model, params.provider);

        // 1. Validate work item exists
        const workItem = await getWorkItemById(params.workItemId, workspaceId);
        if (!workItem) {
          return {
            content: [{ type: "text" as const, text: `Error: Work item '${params.workItemId}' not found` }],
            isError: true,
          };
        }

        // 2. Resolve the destination column for a passing validation result.
        const requestedDestinationColumnId =
          params.releaseColumnId ?? params.toDocumentColumnId ?? params.validatingColumnId ?? null;

        const boardColumnsForWorkItem = await db
          .select({
            id: boardColumns.id,
            boardId: boardColumns.boardId,
            name: boardColumns.name,
            role: boardColumns.role,
          })
          .from(boardColumns)
          .where(eq(boardColumns.boardId, workItem.boardId));

        const resolveColumnRole = (column: { name: string | null; role: string | null }): ColumnRole =>
          (column.role && column.role !== "other")
            ? column.role as ColumnRole
            : inferRoleFromName(column.name ?? "");

        const requestedColumn = requestedDestinationColumnId
          ? boardColumnsForWorkItem.find((column) => column.id === requestedDestinationColumnId) ?? null
          : null;

        if (requestedDestinationColumnId && !requestedColumn) {
          return {
            content: [{ type: "text" as const, text: `Error: Board column '${requestedDestinationColumnId}' not found on board '${workItem.boardId}'` }],
            isError: true,
          };
        }

        const releaseColumn =
          boardColumnsForWorkItem.find((column) => resolveColumnRole(column) === "release") ?? null;
        const toDocumentColumn =
          boardColumnsForWorkItem.find((column) => resolveColumnRole(column) === "to_document") ?? null;

        let destinationColumn = requestedColumn ?? releaseColumn ?? toDocumentColumn;
        let autoRedirectedToRelease = false;

        if (
          requestedColumn &&
          (resolveColumnRole(requestedColumn) === "validating" || resolveColumnRole(requestedColumn) === "to_document") &&
          releaseColumn &&
          releaseColumn.id !== requestedColumn.id
        ) {
          destinationColumn = releaseColumn;
          autoRedirectedToRelease = true;
        }

        if (!destinationColumn) {
          return {
            content: [{
              type: "text" as const,
              text: "Error: Could not resolve a destination column for a passing validation result. Pass `releaseColumnId` or ensure the board has a Release column.",
            }],
            isError: true,
          };
        }

        // 3. Move to the resolved destination column (normally Release)
        const moveSuccess = await moveWorkItem(params.workItemId, destinationColumn.id, 0);
        if (!moveSuccess) {
          return {
            content: [{ type: "text" as const, text: `Error: Failed to move work item to '${destinationColumn.name}'` }],
            isError: true,
          };
        }

        // 4. Clear AI processing flag
        await setWorkItemAiProcessing(workspaceId, params.workItemId, false);

        // 5. Merge metadata: documentation, testResults, provider info
        const existingMeta = (workItem.metadata as Record<string, unknown> | undefined) ?? {};
        const inferredManagedBy = getManagedByFromProvider(provider);

        const updatedMeta: Record<string, unknown> = {
          ...existingMeta,
          aiReserved: false,
          aiProvider: provider,
          aiModel: params.model,
        };

        if (params.documentation) {
          const existingDocs = (existingMeta.documentation as Record<string, unknown>) ?? {};
          updatedMeta.documentation = {
            ...existingDocs,
            ...params.documentation,
            validatedAt: new Date().toISOString(),
          };
        }

        if (params.testResults) {
          updatedMeta.testResults = {
            ...params.testResults,
            testedAt: new Date().toISOString(),
          };
        }

        const merged = mergeManagedByMetadata(existingMeta, updatedMeta, inferredManagedBy);
        if (merged) {
          await updateWorkItem(workspaceId, params.workItemId, { metadata: merged });
        }

        // 6. Record AI session with cost calculation
        const inputTokens = Math.round(params.totalTokens * 0.8);
        const outputTokens = params.totalTokens - inputTokens;
        const computedCost = calculateCostUsd({ provider, model: params.model, inputTokens, outputTokens });
        const estimatedCost = computedCost ?? 0;

        const completeReviewUserId = getUserIdFromExtra(extra);
        const session = await createAiSession(workspaceId, {
          workItemId: params.workItemId,
          model: params.model,
          provider,
          inputTokens,
          outputTokens,
          totalTokens: params.totalTokens,
          estimatedCost: String(estimatedCost),
          durationMs: params.durationMs ?? null,
          sessionType: "validate",
          metadata: {
            taskId: params.taskId ?? workItem.taskId ?? null,
            skill: "validate",
            tokenSplitEstimated: true,
            source: "mcp",
            ...(completeReviewUserId ? { requestedByUserId: completeReviewUserId } : {}),
          },
        });

        // 6b. Record agent action event
        getActivityLogger().log({
          actorUserId: (completeReviewUserId ?? null) as string,
          workspaceId,
          action: 'ai_session',
          resourceType: 'work_item',
          resourceId: params.workItemId,
          metadata: {
            triggeredBy: 'claude-code',
            action: 'validation' as const,
            model: params.model,
            result: 'pass' as const,
            durationMs: params.durationMs,
            tokensUsed: params.totalTokens,
            source: 'mcp',
            ...(completeReviewUserId ? { requestedByUserId: completeReviewUserId } : {}),
          },
        });

        await recordQuotaUsage(
          workspaceId,
          provider,
          params.totalTokens,
          estimatedCost,
        );

        // 7. Broadcast WebSocket events
        // Mark `metadata: true` because step 5 rewrites lastValidationResult,
        // lastValidationPassedAt, documentation, testResults, etc. Without it,
        // listeners scanning `changes` would only react to the column move
        // and keep showing stale validation/DoD-derived state.
        const updatedItem = await getWorkItemById(params.workItemId, workspaceId);
        wsConnectionManager.broadcastToWorkspace(workspaceId, {
          type: "work-item:updated",
          payload: {
            workItemId: params.workItemId,
            boardId: updatedItem?.boardId ?? workItem.boardId ?? undefined,
            changes: {
              metadata: true,
              boardColumnId: destinationColumn.id,
              isAiProcessing: false,
            },
          },
        });

        wsConnectionManager.broadcastToWorkspace(workspaceId, {
          type: "ai:session-recorded",
          payload: {
            workItemId: params.workItemId,
            boardId: workItem.boardId ?? null,
            taskId: workItem.taskId ?? null,
            title: workItem.title ?? null,
            model: session.model,
            provider: session.provider,
            inputTokens: session.inputTokens,
            outputTokens: session.outputTokens,
            totalTokens: session.totalTokens,
            estimatedCost: session.estimatedCost,
            durationMs: session.durationMs,
            sessionType: session.sessionType,
            metadata: (session.metadata ?? {}) as Record<string, unknown>,
            createdAt: session.createdAt instanceof Date ? session.createdAt.toISOString() : session.createdAt,
          },
        });

        // 8. Telegram & email notifications (best-effort)
        notifyWorkItemMoved({
          workItemId: params.workItemId,
          fromColumnName: workItem.columnName ?? "Validating",
          toColumnName: destinationColumn.name ?? "Release",
        }).catch(() => {});
        emailNotifyWorkItemMoved({
          workItemId: params.workItemId,
          fromColumnName: workItem.columnName ?? "Validating",
          toColumnName: destinationColumn.name ?? "Release",
        }).catch(() => {});

        return {
          content: [{
            type: "text" as const,
            text: JSON.stringify({
              completed: true,
              workItemId: params.workItemId,
              movedTo: destinationColumn.name,
              destinationColumnId: destinationColumn.id,
              autoRedirectedToRelease,
              sessionId: session.id,
              estimatedCost: `$${estimatedCost.toFixed(4)}`,
              totalTokens: params.totalTokens,
            }, null, 2),
          }],
        };
      } catch (error) {
        return {
          content: [{ type: "text" as const, text: `Error completing validation: ${error instanceof Error ? error.message : String(error)}` }],
          isError: true,
        };
      }
    }
  );

  // -------------------------------------------------------
  // complete_validation_fail - Move back to In Progress after failed validation
  // -------------------------------------------------------
  server.tool(
    "complete_validation_fail",
    "Complete a failed validation for a task: move back to In Progress for corrective work, record diagnosis as structured event and visible comment, clear AI processing flags, and record the AI session. Legacy Needs Fix columns are supported only as a fallback.",
    {
      workItemId: z.string().uuid().describe("The work item ID that failed validation"),
      inProgressColumnId: z.string().uuid().optional().describe("The ID of the In Progress column. If omitted, auto-detected from the board."),
      needsFixColumnId: z.string().uuid().optional().describe("Deprecated legacy fallback. Prefer inProgressColumnId."),
      diagnosis: z.string().describe("Detailed diagnosis of what failed (Markdown format). This becomes both a structured event and a visible comment."),
      model: z.string().describe("The AI model that performed the validation (e.g. 'claude-opus-4-6')"),
      provider: z.string().optional().describe("AI provider (optional; inferred from model when omitted)"),
      totalTokens: z.number().int().min(0).describe("Total tokens consumed (input + output)"),
      durationMs: z.number().int().min(0).optional().describe("Session duration in milliseconds"),
      taskId: z.string().optional().describe("Human-readable task ID (e.g. 'A-355')"),
    },
    async (params, extra) => {
      try {
        const workspaceId = getWorkspaceIdFromExtra(extra);
        if (!workspaceId) {
          return { content: [{ type: "text" as const, text: "Error: could not resolve workspaceId from API key" }], isError: true };
        }

        const provider = inferAiProvider(params.model, params.provider);

        // 1. Validate work item exists
        const workItem = await getWorkItemById(params.workItemId, workspaceId);
        if (!workItem) {
          return {
            content: [{ type: "text" as const, text: `Error: Work item '${params.workItemId}' not found` }],
            isError: true,
          };
        }

        // 2. Find the In Progress column (legacy fallback: Needs Fix)
        let targetColumn: { id: string; name: string } | undefined;

        if (params.inProgressColumnId ?? params.needsFixColumnId) {
          // Use the explicitly provided column ID
          const requestedColumnId = params.inProgressColumnId ?? params.needsFixColumnId!;
          const [column] = await db
            .select({ id: boardColumns.id, name: boardColumns.name })
            .from(boardColumns)
            .where(eq(boardColumns.id, requestedColumnId))
            .limit(1);

          if (!column) {
            return {
              content: [{ type: "text" as const, text: `Error: Board column '${requestedColumnId}' not found` }],
              isError: true,
            };
          }
          targetColumn = column;
        } else {
          // Auto-detect from board
          if (!workItem.boardId) {
            return {
              content: [{ type: "text" as const, text: `Error: Work item '${params.workItemId}' is not associated with a board and no inProgressColumnId was provided` }],
              isError: true,
            };
          }

          const columns = await db
            .select({ id: boardColumns.id, name: boardColumns.name, role: boardColumns.role })
            .from(boardColumns)
            .where(eq(boardColumns.boardId, workItem.boardId));

          targetColumn = columns.find((col) => col.role === "in_progress")
            ?? columns.find((col) => /progress|doing|en progreso/i.test(col.name))
            ?? columns.find((col) => col.role === "needs_fix")
            ?? columns.find((col) => /needs\s*fix|needs\s*attention/i.test(col.name));

          if (!targetColumn) {
            return {
              content: [{ type: "text" as const, text: `Error: Could not find an 'In Progress' column on the board. Available columns: ${columns.map((c) => c.name).join(", ")}. Provide inProgressColumnId explicitly.` }],
              isError: true,
            };
          }
        }

        // 3. Move to In Progress column (top position)
        const moveSuccess = await moveWorkItem(params.workItemId, targetColumn.id, 0);
        if (!moveSuccess) {
          return {
            content: [{ type: "text" as const, text: `Error: Failed to move work item to '${targetColumn.name}'` }],
            isError: true,
          };
        }

        // 4. Clear AI processing flag
        await setWorkItemAiProcessing(workspaceId, params.workItemId, false);

        // 5. Update metadata: clear aiReserved, merge provider info, increment fixAttempts
        const existingMeta = (workItem.metadata as Record<string, unknown> | undefined) ?? {};
        const inferredManagedBy = getManagedByFromProvider(provider);
        const previousFixAttempts = typeof existingMeta.fixAttempts === "number" ? existingMeta.fixAttempts : 0;

        const updatedMeta: Record<string, unknown> = {
          ...existingMeta,
          aiReserved: false,
          aiProvider: provider,
          aiModel: params.model,
          lastValidationResult: "fail",
          lastValidationDiagnosis: params.diagnosis,
          lastValidationFailedAt: new Date().toISOString(),
          fixAttempts: previousFixAttempts + 1,
        };

        const merged = mergeManagedByMetadata(existingMeta, updatedMeta, inferredManagedBy);
        if (merged) {
          await updateWorkItem(workspaceId, params.workItemId, { metadata: merged });
        }

        // 6. Create work_item_event with structured diagnosis
        const userId = getUserIdFromExtra(extra);
        getActivityLogger().log({
          actorUserId: (userId ?? null) as string,
          workspaceId,
          action: 'ai_session',
          resourceType: 'work_item',
          resourceId: params.workItemId,
          metadata: {
            triggeredBy: 'claude-code',
            action: 'validation_fail' as const,
            model: params.model,
            result: 'fail' as const,
            diagnosis: params.diagnosis,
            durationMs: params.durationMs,
            tokensUsed: params.totalTokens,
            timestamp: new Date().toISOString(),
            source: 'mcp',
            ...(userId ? { requestedByUserId: userId } : {}),
          },
        });

        // 7. Create a visible comment with the diagnosis
        const commentContent = `## Validation Failed\n\n${params.diagnosis}`;
        await createEntityComment(
          "work_item",
          params.workItemId,
          userId ?? "system",
          commentContent,
        );

        // 8. Record AI session with cost calculation
        const inputTokens = Math.round(params.totalTokens * 0.8);
        const outputTokens = params.totalTokens - inputTokens;
        const computedCost = calculateCostUsd({ provider, model: params.model, inputTokens, outputTokens });
        const estimatedCost = computedCost ?? 0;

        const session = await createAiSession(workspaceId, {
          workItemId: params.workItemId,
          model: params.model,
          provider,
          inputTokens,
          outputTokens,
          totalTokens: params.totalTokens,
          estimatedCost: String(estimatedCost),
          durationMs: params.durationMs ?? null,
          sessionType: "validate",
          metadata: {
            taskId: params.taskId ?? workItem.taskId ?? null,
            skill: "validate",
            result: "fail",
            tokenSplitEstimated: true,
            source: "mcp",
            ...(userId ? { requestedByUserId: userId } : {}),
          },
        });

        // 9. Broadcast WebSocket events
        // Mark `metadata: true` because step 5 rewrites lastValidationResult,
        // lastValidationDiagnosis, lastValidationFailedAt, fixAttempts, etc.
        // Without it, listeners scanning `changes` would only react to the
        // column move back to In Progress and keep showing the stale
        // validation/DoD-derived state from before the failure.
        const updatedItem = await getWorkItemById(params.workItemId, workspaceId);
        wsConnectionManager.broadcastToWorkspace(workspaceId, {
          type: "work-item:updated",
          payload: {
            workItemId: params.workItemId,
            boardId: updatedItem?.boardId ?? workItem.boardId ?? undefined,
            changes: {
              metadata: true,
              boardColumnId: targetColumn.id,
              isAiProcessing: false,
            },
          },
        });

        wsConnectionManager.broadcastToWorkspace(workspaceId, {
          type: "ai:session-recorded",
          payload: {
            workItemId: params.workItemId,
            boardId: workItem.boardId ?? null,
            taskId: workItem.taskId ?? null,
            title: workItem.title ?? null,
            model: session.model,
            provider: session.provider,
            inputTokens: session.inputTokens,
            outputTokens: session.outputTokens,
            totalTokens: session.totalTokens,
            estimatedCost: session.estimatedCost,
            durationMs: session.durationMs,
            sessionType: session.sessionType,
            metadata: (session.metadata ?? {}) as Record<string, unknown>,
            createdAt: session.createdAt instanceof Date ? session.createdAt.toISOString() : session.createdAt,
          },
        });

        // 10. Telegram & email notifications (best-effort)
        notifyWorkItemMoved({
          workItemId: params.workItemId,
          fromColumnName: workItem.columnName ?? "Testing",
          toColumnName: targetColumn.name ?? "In Progress",
        }).catch(() => {});
        emailNotifyWorkItemMoved({
          workItemId: params.workItemId,
          fromColumnName: workItem.columnName ?? "Testing",
          toColumnName: targetColumn.name ?? "In Progress",
        }).catch(() => {});

        return {
          content: [{
            type: "text" as const,
            text: JSON.stringify({
              completed: true,
              result: "fail",
              workItemId: params.workItemId,
              movedTo: targetColumn.name,
              fixAttempt: previousFixAttempts + 1,
              sessionId: session.id,
              estimatedCost: `$${estimatedCost.toFixed(4)}`,
              totalTokens: params.totalTokens,
            }, null, 2),
          }],
        };
      } catch (error) {
        return {
          content: [{ type: "text" as const, text: `Error completing validation fail: ${error instanceof Error ? error.message : String(error)}` }],
          isError: true,
        };
      }
    }
  );

  // -------------------------------------------------------
  // complete_documentation - Move to Done after documentation
  // -------------------------------------------------------
  server.tool(
    "complete_documentation",
    "Atomically complete documentation for a task: move to Done column, clear AI processing flags, create/link a document in Almirant, merge documentation metadata, and record the AI session. Use this single call instead of separate move + document + record calls.",
    {
      workItemId: z.string().uuid().describe("The work item ID to complete documentation for"),
      doneColumnId: z.string().uuid().describe("The ID of the Done column to move the task into"),
      documentTitle: z.string().describe("Title for the generated document"),
      documentContent: z.string().describe("Markdown content of the generated document"),
      documentCategoryId: z.string().uuid().optional().describe("Category ID for the document"),
      screenshotUrls: z.array(z.string()).optional().describe("URLs of screenshots attached to the work item"),
      walkthroughUrls: z.array(z.string()).optional().describe("URLs of walkthrough video recordings attached to the work item"),
      model: z.string().describe("The AI model used (e.g. 'claude-opus-4-6')"),
      provider: z.string().optional().describe("AI provider (optional; inferred from model when omitted)"),
      totalTokens: z.number().int().min(0).describe("Total tokens consumed (input + output)"),
      durationMs: z.number().int().min(0).optional().describe("Session duration in milliseconds"),
      taskId: z.string().optional().describe("Human-readable task ID (e.g. 'A-355')"),
    },
    async (params, extra) => {
      try {
        const workspaceId = getWorkspaceIdFromExtra(extra);
        if (!workspaceId) {
          return { content: [{ type: "text" as const, text: "Error: could not resolve workspaceId from API key" }], isError: true };
        }

        const provider = inferAiProvider(params.model, params.provider);

        // 1. Validate work item exists
        const workItem = await getWorkItemById(params.workItemId, workspaceId);
        if (!workItem) {
          return {
            content: [{ type: "text" as const, text: `Error: Work item '${params.workItemId}' not found` }],
            isError: true,
          };
        }

        // 2. Validate target column exists
        const [column] = await db
          .select({ id: boardColumns.id, name: boardColumns.name })
          .from(boardColumns)
          .where(eq(boardColumns.id, params.doneColumnId))
          .limit(1);

        if (!column) {
          return {
            content: [{ type: "text" as const, text: `Error: Board column '${params.doneColumnId}' not found` }],
            isError: true,
          };
        }

        // 3. Move to Done column (top position)
        const moveSuccess = await moveWorkItem(params.workItemId, params.doneColumnId, 0);
        if (!moveSuccess) {
          return {
            content: [{ type: "text" as const, text: `Error: Failed to move work item to '${column.name}'` }],
            isError: true,
          };
        }

        // 4. Clear AI processing flag
        await setWorkItemAiProcessing(workspaceId, params.workItemId, false);

        // 5. Create document in Almirant and link to work item
        let documentId: string | null = null;
        try {
          const doc = await createDocument(workspaceId, {
            title: params.documentTitle,
            content: params.documentContent,
            categoryId: params.documentCategoryId,
            projectId: workItem.projectId ?? undefined,
          });
          if (doc) {
            documentId = doc.id;
            await linkDocumentToWorkItem(doc.id, params.workItemId);
          }
        } catch (docError) {
          // Document creation is best-effort — don't fail the whole operation
          console.error("Failed to create/link document:", docError);
        }

        // 6. Merge metadata: documentation, provider info
        const existingMeta = (workItem.metadata as Record<string, unknown> | undefined) ?? {};
        const inferredManagedBy = getManagedByFromProvider(provider);

        const updatedMeta: Record<string, unknown> = {
          ...existingMeta,
          aiReserved: false,
          aiProvider: provider,
          aiModel: params.model,
        };

        const existingDocs = (existingMeta.documentation as Record<string, unknown>) ?? {};
        updatedMeta.documentation = {
          ...existingDocs,
          documentTitle: params.documentTitle,
          documentId,
          screenshots: params.screenshotUrls ?? [],
          walkthroughUrls: params.walkthroughUrls ?? [],
          documentedAt: new Date().toISOString(),
        };

        const merged = mergeManagedByMetadata(existingMeta, updatedMeta, inferredManagedBy);
        if (merged) {
          await updateWorkItem(workspaceId, params.workItemId, { metadata: merged });
        }

        // 7. Record AI session with cost calculation
        const inputTokens = Math.round(params.totalTokens * 0.8);
        const outputTokens = params.totalTokens - inputTokens;
        const computedCost = calculateCostUsd({ provider, model: params.model, inputTokens, outputTokens });
        const estimatedCost = computedCost ?? 0;

        const documentUserId = getUserIdFromExtra(extra);
        const session = await createAiSession(workspaceId, {
          workItemId: params.workItemId,
          model: params.model,
          provider,
          inputTokens,
          outputTokens,
          totalTokens: params.totalTokens,
          estimatedCost: String(estimatedCost),
          durationMs: params.durationMs ?? null,
          sessionType: "document",
          metadata: {
            taskId: params.taskId ?? workItem.taskId ?? null,
            skill: "document",
            tokenSplitEstimated: true,
            source: "mcp",
            ...(documentUserId ? { requestedByUserId: documentUserId } : {}),
          },
        });

        // 7b. Record agent action event
        getActivityLogger().log({
          actorUserId: (documentUserId ?? null) as string,
          workspaceId,
          action: 'ai_session',
          resourceType: 'work_item',
          resourceId: params.workItemId,
          metadata: {
            triggeredBy: 'claude-code',
            action: 'documentation' as const,
            model: params.model,
            result: 'pass' as const,
            documentId,
            durationMs: params.durationMs,
            tokensUsed: params.totalTokens,
            source: 'mcp',
            ...(documentUserId ? { requestedByUserId: documentUserId } : {}),
          },
        });

        // 8. Broadcast WebSocket events
        const updatedItem = await getWorkItemById(params.workItemId, workspaceId);
        wsConnectionManager.broadcastToWorkspace(workspaceId, {
          type: "work-item:updated",
          payload: {
            workItemId: params.workItemId,
            boardId: updatedItem?.boardId ?? workItem.boardId ?? undefined,
            changes: { boardColumnId: params.doneColumnId, isAiProcessing: false },
          },
        });

        wsConnectionManager.broadcastToWorkspace(workspaceId, {
          type: "ai:session-recorded",
          payload: {
            workItemId: params.workItemId,
            boardId: workItem.boardId ?? null,
            taskId: workItem.taskId ?? null,
            title: workItem.title ?? null,
            model: session.model,
            provider: session.provider,
            inputTokens: session.inputTokens,
            outputTokens: session.outputTokens,
            totalTokens: session.totalTokens,
            estimatedCost: session.estimatedCost,
            durationMs: session.durationMs,
            sessionType: session.sessionType,
            metadata: (session.metadata ?? {}) as Record<string, unknown>,
            createdAt: session.createdAt instanceof Date ? session.createdAt.toISOString() : session.createdAt,
          },
        });

        // 9. Telegram & email notifications (best-effort)
        notifyWorkItemDone({
          workItemId: params.workItemId,
        }).catch(() => {});
        emailNotifyWorkItemDone({
          workItemId: params.workItemId,
        }).catch(() => {});

        return {
          content: [{
            type: "text" as const,
            text: JSON.stringify({
              completed: true,
              workItemId: params.workItemId,
              movedTo: column.name,
              documentId,
              sessionId: session.id,
              estimatedCost: `$${estimatedCost.toFixed(4)}`,
              totalTokens: params.totalTokens,
            }, null, 2),
          }],
        };
      } catch (error) {
        return {
          content: [{ type: "text" as const, text: `Error completing documentation: ${error instanceof Error ? error.message : String(error)}` }],
          isError: true,
        };
      }
    }
  );

  // ── Work Item Comments ──

  server.tool(
    "list_work_item_comments",
    "List comments for a work item",
    {
      workItemId: z.string().uuid().describe("The work item ID to list comments for"),
    },
    async (params, extra) => {
      try {
        const workspaceId = getWorkspaceIdFromExtra(extra);
        if (!workspaceId) {
          return {
            content: [{ type: "text" as const, text: "Error: could not resolve workspaceId from API key" }],
            isError: true,
          };
        }

        const workItem = await getWorkItemById(params.workItemId, workspaceId);
        if (!workItem) {
          return {
            content: [{ type: "text" as const, text: `Work item ${params.workItemId} not found` }],
            isError: true,
          };
        }

        const comments = await getEntityComments("work_item", params.workItemId);
        return { content: [{ type: "text" as const, text: JSON.stringify(comments, null, 2) }] };
      } catch (error) {
        return {
          content: [{ type: "text" as const, text: `Error listing comments: ${error instanceof Error ? error.message : String(error)}` }],
          isError: true,
        };
      }
    }
  );

  server.tool(
    "add_work_item_comment",
    "Add a comment to a work item. Use this to leave review notes, failure details, or general remarks on a work item.",
    {
      workItemId: z.string().uuid().describe("The work item ID to comment on"),
      content: z.string().min(1).describe("The comment content (supports Markdown)"),
    },
    async (params, extra) => {
      try {
        const workspaceId = getWorkspaceIdFromExtra(extra);
        if (!workspaceId) {
          return {
            content: [{ type: "text" as const, text: "Error: could not resolve workspaceId from API key" }],
            isError: true,
          };
        }

        const userId = getUserIdFromExtra(extra);
        if (!userId) {
          return {
            content: [{ type: "text" as const, text: "Error: could not resolve userId from API key" }],
            isError: true,
          };
        }

        const workItem = await getWorkItemById(params.workItemId, workspaceId);
        if (!workItem) {
          return {
            content: [{ type: "text" as const, text: `Work item ${params.workItemId} not found` }],
            isError: true,
          };
        }

        const comment = await createEntityComment(
          "work_item",
          params.workItemId,
          userId,
          params.content
        );

        // Also create a work item event so the comment appears in the event timeline
        getActivityLogger().log({
          actorUserId: userId,
          workspaceId,
          action: "comment",
          resourceType: "work_item",
          resourceId: params.workItemId,
          metadata: {
            triggeredBy: "mcp",
            newValue: params.content,
            source: "mcp",
            requestedByUserId: userId,
          },
        });

        return { content: [{ type: "text" as const, text: JSON.stringify(comment, null, 2) }] };
      } catch (error) {
        return {
          content: [{ type: "text" as const, text: `Error adding comment: ${error instanceof Error ? error.message : String(error)}` }],
          isError: true,
        };
      }
    }
  );

  // ── set_implementation_outcomes ──────────────────────────────────────
  server.tool(
    "set_implementation_outcomes",
    "Write categorized implementation outcomes to a work item's metadata. Use this after completing implementation to record deploy steps, validation checks, and documentation notes. Only provided fields are written; existing metadata is preserved.",
    {
      workItemId: z.string().uuid().describe("The work item ID to update"),
      deployChecklist: z.string().optional().describe("Markdown checklist of deploy steps (e.g. '- [ ] Run migrations\\n- [ ] Clear cache')"),
      validationChecks: z.string().optional().describe("Markdown checklist of validation steps to verify the implementation"),
      documentationNotes: z.string().optional().describe("Markdown notes about what needs documenting after this change"),
    },
    async (params, extra) => {
      try {
        const workspaceId = getWorkspaceIdFromExtra(extra);
        if (!workspaceId) {
          return {
            content: [{ type: "text" as const, text: "Error: could not resolve workspaceId from API key" }],
            isError: true,
          };
        }

        const workItem = await getWorkItemById(params.workItemId, workspaceId);
        if (!workItem) {
          return {
            content: [{ type: "text" as const, text: `Error: Work item '${params.workItemId}' not found` }],
            isError: true,
          };
        }

        const existingMeta = (workItem.metadata as Record<string, unknown> | undefined) ?? {};
        const updatedMeta: Record<string, unknown> = {};
        const fieldsUpdated: string[] = [];

        if (params.deployChecklist !== undefined) {
          updatedMeta.deployChecklist = params.deployChecklist;
          fieldsUpdated.push("deployChecklist");
        }
        if (params.validationChecks !== undefined) {
          updatedMeta.validationChecks = params.validationChecks;
          fieldsUpdated.push("validationChecks");
        }
        if (params.documentationNotes !== undefined) {
          updatedMeta.documentationNotes = params.documentationNotes;
          fieldsUpdated.push("documentationNotes");
        }

        if (fieldsUpdated.length === 0) {
          return {
            content: [{ type: "text" as const, text: "No fields provided. Supply at least one of: deployChecklist, validationChecks, documentationNotes." }],
            isError: true,
          };
        }

        const merged = mergeManagedByMetadata(existingMeta, updatedMeta, undefined);
        if (merged) {
          await updateWorkItem(workspaceId, params.workItemId, { metadata: merged });
        }

        wsConnectionManager.broadcastToWorkspace(workspaceId, {
          type: "work-item:updated",
          payload: {
            workItemId: params.workItemId,
            boardId: workItem.boardId ?? undefined,
            changes: { metadata: true },
          },
        });

        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(
                {
                  success: true,
                  workItemId: params.workItemId,
                  fieldsUpdated,
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
              text: `Error setting implementation outcomes: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
          isError: true,
        };
      }
    }
  );
};

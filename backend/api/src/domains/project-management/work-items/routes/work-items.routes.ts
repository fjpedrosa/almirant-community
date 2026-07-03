import { Elysia, t } from "elysia";
import { sessionContextTypes } from "../../../../shared/middleware/session-context-types.plugin";
import {
  getWorkItems,
  getWorkItemById,
  createWorkItem,
  updateWorkItem,
  deleteWorkItem,
  moveWorkItem,
  changeParent,
  bulkMoveWorkItems,
  getDescendantLeafIds,
  bulkChangePriority,
  saveGeneratedPrompt,
  getAttachmentsByWorkItem,
  createAttachment,
  deleteAttachment,
  getAttachment,
  getAiSessionsSummaryByWorkItemId,
  getJobsByWorkItem,
  createAiSession,
  getWorkItemEventsByWorkItemId,
  getEventsByWorkItemIds,
  getParticipantsByWorkItemIds,
  getEventsByDateRange,
  getAgentActionsByWorkItemId,
  getDirectChildrenBasic,
  getBoardColumnsByIds,
  getDependencies,
  getDependents,
  addDependency,
  removeDependency,
  getCommitsByWorkItemId,
  linkCommitToWorkItem,
  unlinkCommitFromWorkItem,
  getDocumentsByWorkItemId,
  linkDocumentToWorkItem,
  unlinkDocumentFromWorkItem,
  createDocument,
  getSuggestedDocuments,
  getInteractionsByWorkItemId,
  getUserById,
  getAssigneesByWorkItem,
  assignUserToWorkItem,
  unassignUserFromWorkItem,
  updateAssigneeRole,
  resolveTaskIds,
  clearWorkItemAiState,
  db,
  workItems,
  projects,
  eq,
  inArray,
  type AgentJobConfig,
} from "@almirant/database";
import {
  successResponse,
  errorResponse,
  notFoundResponse,
  parsePaginationParams,
  buildPaginationMeta,
} from "../../../../shared/services/response";
import { wsConnectionManager } from "../../../../shared/ws/ws-connection-manager";
import { calculateCostUsd, type AiProvider } from "../../../../domains/billing/quota/services/ai-model-pricing";
import { quotaService } from "../../../../domains/billing/quota/services/quota-service-instance";
import {
  uploadBufferToS3,
  deleteFromS3,
  generateAttachmentKey,
  extractKeyFromUrl,
  isS3Configured,
} from "../../../../shared/services/s3-service";
import { resolveLocalAttachmentPath, writeLocalAttachment, deleteLocalAttachment } from "../../../../shared/services/local-attachments";
import { gatherWorkItemContext, buildEnrichedPromptInput } from "../services/prompt-context-service";
import { getWorkItemProvenance } from "../services/work-item-provenance-service";
import { formatText, isAiConfigured, generateDocumentation } from "../../../../domains/ai/shared/services/ai-service";
import { resolveModelFromProviderKey, withAuthErrorDetection } from "../../../../domains/ai/shared/services/model-factory";
import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import { isParentType } from "@almirant/database";
import { getActivityLogger } from "@almirant/shared";
import { logger } from "@almirant/config";
import { propagateProviderToParent } from "../../../../domains/connections/services/propagate-provider";
import { enqueueEffortEstimation } from "../../../../domains/agents/services/enqueue-effort-estimation";
import {
  notifyWorkItemAssigned,
  notifyWorkItemDone,
  notifyWorkItemMoved,
  notifyUserActions,
} from "../../../../domains/integrations/telegram/services/telegram/notifications";
import {
  emailNotifyWorkItemAssigned,
  emailNotifyWorkItemDone,
  emailNotifyWorkItemMoved,
  emailNotifyUserActions,
} from "../../../../shared/services/email/notifications";
import { workItemsTypedCreateRoutes } from "./work-items-typed-create.routes";
import {
  buildWorkItemResourceForecast,
  refreshResourceForecastForAffectedBlocks,
} from "../../../../domains/agents/services/resource-forecast";

const VALID_PRIORITIES = ["low", "medium", "high", "urgent"] as const;
const VALID_TYPES = ["epic", "feature", "story", "task", "idea"] as const;
type ManagedByAgent = "claude-code" | "codex";

const inferAiProvider = (model: string, provider?: string): AiProvider => {
  const normalizedProvider = provider?.trim().toLowerCase().replace(/_/g, "-");
  const normalizedModel = model.trim().toLowerCase();

  if (normalizedProvider === "anthropic") return "anthropic";
  if (normalizedProvider === "openai") return "openai";
  if (normalizedProvider === "google") return "google";
  if (normalizedProvider === "openai-compatible") return "zai";
  if (normalizedProvider === "zai") return "zai";

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

  return "anthropic";
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
      "work-items.routes: failed to record quota usage"
    );
  }
};

const getManagedByAgents = (metadata: Record<string, unknown> | undefined): ManagedByAgent[] => {
  if (!metadata) return [];

  const values: string[] = [];
  const rawManagedBy = metadata.managedBy;
  const rawManagedByAgents = metadata.managedByAgents;

  if (typeof rawManagedBy === "string") {
    values.push(rawManagedBy);
  } else if (Array.isArray(rawManagedBy)) {
    values.push(...rawManagedBy.filter((v): v is string => typeof v === "string"));
  }

  if (typeof rawManagedByAgents === "string") {
    values.push(rawManagedByAgents);
  } else if (Array.isArray(rawManagedByAgents)) {
    values.push(...rawManagedByAgents.filter((v): v is string => typeof v === "string"));
  }

  const unique = new Set<ManagedByAgent>();
  for (const value of values) {
    if (value === "claude-code" || value === "codex") {
      unique.add(value);
    }
  }

  return Array.from(unique);
};

const normalizeMetadataWithAgents = (
  incomingMetadata: Record<string, unknown> | undefined,
  existingMetadata?: Record<string, unknown> | null
): Record<string, unknown> | undefined => {
  if (!incomingMetadata && !existingMetadata) return undefined;
  const next = { ...(existingMetadata ?? {}), ...(incomingMetadata ?? {}) };
  const mergedAgents = new Set<ManagedByAgent>([
    ...getManagedByAgents(existingMetadata ?? undefined),
    ...getManagedByAgents(incomingMetadata),
  ]);

  if (mergedAgents.size > 0) {
    next.managedByAgents = Array.from(mergedAgents);

    // Keep managedBy as the latest single actor when provided, fallback to first known actor
    const incomingManagedBy = incomingMetadata?.managedBy;
    if (incomingManagedBy === "claude-code" || incomingManagedBy === "codex") {
      next.managedBy = incomingManagedBy;
    } else if (
      next.managedBy !== "claude-code" &&
      next.managedBy !== "codex"
    ) {
      next.managedBy = Array.from(mergedAgents)[0];
    }
  }

  return next;
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

const getTriggeredByFromMetadata = (
  metadata: Record<string, unknown> | undefined
): "user" | "claude-code" => {
  const managedBy = metadata?.managedBy;
  return managedBy === "claude-code" ? "claude-code" : "user";
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

export const workItemsRoutes = new Elysia({ prefix: "/work-items" })
  .use(sessionContextTypes)

  // ── Bulk operations (must be registered before /:id) ────────────

  // POST /work-items/bulk/move - Bulk move work items to a column
  .post(
    "/bulk/move",
    async (ctx) => {
      const { body, set, activeWorkspace } = ctx;
      const user = (ctx as { user?: { id?: string } }).user;
      const orgId = activeWorkspace!.id;
      if (!body.workItemIds || body.workItemIds.length === 0) {
        set.status = 400;
        return errorResponse("Work item IDs are required");
      }

      if (!body.boardColumnId) {
        set.status = 400;
        return errorResponse("Board column ID is required");
      }

      // Resolve the selection to concrete leaf work items. Parent-type items
      // (epic/feature/story) have no board column of their own, so a bulk move
      // must cascade to their descendant leaf tasks instead of being silently
      // dropped by the repository — mirroring the single-item
      // PATCH /work-items/:id/move handler, which expands via getDescendantLeafIds.
      const selectedItems = await Promise.all(
        body.workItemIds.map((id) => getWorkItemById(id, orgId))
      );

      const leafIdSet = new Set<string>();
      for (let i = 0; i < body.workItemIds.length; i++) {
        const selectedId = body.workItemIds[i]!;
        const selectedItem = selectedItems[i];
        if (selectedItem && isParentType(selectedItem.type)) {
          const descendantLeafIds = await getDescendantLeafIds(selectedItem.id);
          for (const leafId of descendantLeafIds) leafIdSet.add(leafId);
        } else {
          // Leaf items (task/idea) — and ids the repository will scope-check —
          // are passed through unchanged.
          leafIdSet.add(selectedId);
        }
      }
      const moveIds = [...leafIdSet];

      if (moveIds.length === 0) {
        set.status = 400;
        return errorResponse("No movable tasks in selection");
      }

      // Capture before states for event tracking
      const beforeItems = await Promise.all(
        moveIds.map((id) => getWorkItemById(id, orgId))
      );

      let success: boolean;
      try {
        success = await bulkMoveWorkItems(orgId, moveIds, body.boardColumnId);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (
          msg.startsWith("BOARD_COLUMN_NOT_FOUND:")
          || msg.startsWith("BOARD_COLUMN_NOT_IN_BOARD:")
          || msg.startsWith("BOARD_COLUMN_NOT_IN_WORKSPACE:")
          || msg.startsWith("BOARD_COLUMN_ROLE_NOT_FOUND:")
          || msg.startsWith("INCOMPLETE_CHECKLIST:")
        ) {
          set.status = 400;
          return errorResponse(msg.replace(/^[A-Z_]+:\\s*/, ""));
        }
        throw err;
      }

      if (!success) {
        set.status = 400;
        return errorResponse("Failed to move work items");
      }

      const movedItems = await Promise.all(
        moveIds.map((workItemId) => getWorkItemById(workItemId, orgId))
      );

      // Create move events for each item that actually changed columns
      for (const movedItem of movedItems) {
        if (!movedItem) continue;
        const beforeItem = beforeItems.find(b => b?.id === movedItem.id);
        if (beforeItem && beforeItem.boardColumnId !== movedItem.boardColumnId) {
          getActivityLogger().log({
            actorUserId: (user?.id ?? null) as string,
            workspaceId: orgId,
            action: "moved",
            resourceType: "work_item",
            resourceId: movedItem.id,
            metadata: {
              triggeredBy: "user",
              fieldName: "boardColumnId",
              oldValue: beforeItem.boardColumnId,
              newValue: movedItem.boardColumnId,
              source: "web",
              requestedByUserId: user?.id,
              processType: "manual",
            },
          });
        }
      }

      for (const movedItem of movedItems) {
        if (!movedItem) continue;
        wsConnectionManager.broadcastToWorkspace(orgId, {
          type: "work-item:updated",
          payload: {
            workItemId: movedItem.id,
            boardId: movedItem.boardId,
            changes: { boardColumnId: movedItem.boardColumnId },
          },
        });
      }

      return successResponse({ moved: true, count: moveIds.length });
    },
    {
      body: t.Object({
        workItemIds: t.Array(t.String()),
        boardColumnId: t.String(),
      }),
    }
  )

  // PATCH /work-items/bulk/priority - Bulk change priority
  .patch(
    "/bulk/priority",
    async ({ body, set, activeWorkspace }) => {
      const orgId = activeWorkspace!.id;
      if (!body.workItemIds || body.workItemIds.length === 0) {
        set.status = 400;
        return errorResponse("Work item IDs are required");
      }

      if (!body.priority || !VALID_PRIORITIES.includes(body.priority as typeof VALID_PRIORITIES[number])) {
        set.status = 400;
        return errorResponse("Valid priority is required (low, medium, high, urgent)");
      }

      const success = await bulkChangePriority(
        orgId,
        body.workItemIds,
        body.priority as typeof VALID_PRIORITIES[number]
      );

      if (!success) {
        set.status = 400;
        return errorResponse("Failed to change priority");
      }

      for (const workItemId of body.workItemIds) {
        wsConnectionManager.broadcastToWorkspace(orgId, {
          type: "work-item:updated",
          payload: {
            workItemId,
            changes: { priority: body.priority },
          },
        });
      }

      return successResponse({ updated: true, count: body.workItemIds.length });
    },
    {
      body: t.Object({
        workItemIds: t.Array(t.String()),
        priority: t.String(),
      }),
    }
  )

  // ── Collection routes ───────────────────────────────────────────

  // GET /work-items - List with pagination and filters
  .get(
    "/",
    async ({ query, activeWorkspace }) => {
      const orgId = activeWorkspace!.id;
      const pagination = parsePaginationParams(query);

      const filters = {
        search: query.search || undefined,
        projectId: query.projectId || undefined,
        boardId: query.boardId || undefined,
        type: (query.type || undefined) as "epic" | "feature" | "story" | "task" | "idea" | undefined,
        priority: (query.priority || undefined) as "low" | "medium" | "high" | "urgent" | undefined,
        assignee: query.assignee || undefined,
        parentId: query.parentId || undefined,
      };

      const { items, total } = await getWorkItems(orgId, pagination, filters);
      const meta = buildPaginationMeta(pagination.page, pagination.limit, total);

      return successResponse(items, meta);
    },
    {
      query: t.Object({
        page: t.Optional(t.String()),
        limit: t.Optional(t.String()),
        search: t.Optional(t.String()),
        projectId: t.Optional(t.String()),
        boardId: t.Optional(t.String()),
        boardColumnId: t.Optional(t.String()),
        type: t.Optional(t.String()),
        priority: t.Optional(t.String()),
        assignee: t.Optional(t.String()),
        parentId: t.Optional(t.String()),
      }),
    }
  )

  // GET /work-items/resolve-task-ids?taskIds=A-1064,A-1065
  .get(
    "/resolve-task-ids",
    async ({ query, set, activeWorkspace }) => {
      const orgId = activeWorkspace!.id;
      const raw = query.taskIds ?? "";
      const taskIds = raw
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);

      if (taskIds.length === 0) {
        return successResponse([]);
      }

      if (taskIds.length > 200) {
        set.status = 400;
        return errorResponse("Maximum 200 task IDs are allowed");
      }

      const results = await resolveTaskIds(taskIds, orgId);
      return successResponse(results);
    },
    {
      query: t.Object({
        taskIds: t.Optional(t.String()),
      }),
    }
  )

  // POST /work-items/participants - Batch list participants for multiple work items
  .post(
    "/participants",
    async ({ body, set }) => {
      if (body.workItemIds.length === 0) {
        set.status = 400;
        return errorResponse("workItemIds is required");
      }

      if (body.workItemIds.length > 500) {
        set.status = 400;
        return errorResponse("Maximum 500 work item IDs are allowed");
      }

      const participantsMap = await getParticipantsByWorkItemIds(body.workItemIds);
      const participants = Object.fromEntries(participantsMap.entries());

      return successResponse(participants);
    },
    {
      body: t.Object({
        workItemIds: t.Array(t.String()),
      }),
    }
  )

  // POST /work-items - Create work item
  .post(
    "/",
    async (ctx) => {
      const { body, set } = ctx;
      const user = (ctx as { user?: { id?: string } }).user;
      const orgId = (ctx as { activeWorkspace?: { id: string } }).activeWorkspace!.id;

      // Backward compatible endpoint. Prefer typed endpoints:
      // POST /work-items/tasks | /stories | /features | /epics
      set.headers.warning =
        '299 - "Deprecated: POST /work-items is deprecated. Use POST /work-items/tasks|stories|features|epics."';

      if (!body.title || body.title.trim() === "") {
        set.status = 400;
        return errorResponse("Title is required");
      }

      if (!body.boardId) {
        set.status = 400;
        return errorResponse("Board ID is required");
      }

      if (!body.type) {
        set.status = 400;
        return errorResponse("Type is required");
      }

      const leafTypes = ["task", "idea"];
      if (!body.boardColumnId && leafTypes.includes(body.type)) {
        set.status = 400;
        return errorResponse("Board column ID is required for task and idea work items");
      }

      const normalizedMetadata = normalizeMetadataWithAgents(
        body.metadata as Record<string, unknown> | undefined
      );

      let item;
      try {
        item = await createWorkItem(orgId, {
          id: body.id,
          projectId: body.projectId || null,
          boardId: body.boardId,
          boardColumnId: body.boardColumnId ?? null,
          parentId: body.parentId,
          type: body.type as typeof VALID_TYPES[number],
          title: body.title.trim(),
          description: body.description,
          priority: body.priority as typeof VALID_PRIORITIES[number] | undefined,
          assignee: body.assignee,
          position: body.position,
          dueDate: body.dueDate,
          estimatedHours: body.estimatedHours,
          metadata: normalizedMetadata,
          tagIds: body.tagIds,
          createdByUserId: user?.id,
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (msg.startsWith("WORK_ITEM_TYPE_NOT_ALLOWED:")) {
          set.status = 400;
          return errorResponse(msg.replace(/^WORK_ITEM_TYPE_NOT_ALLOWED:\\s*/, ""));
        }
        if (msg.startsWith("PARENT_COMPLETED:")) {
          set.status = 400;
          return errorResponse(msg.replace(/^PARENT_COMPLETED:\\s*/, ""));
        }
        if (msg.startsWith("PARENT_NOT_IN_BACKLOG:")) {
          set.status = 400;
          return errorResponse(msg.replace(/^PARENT_NOT_IN_BACKLOG:\\s*/, ""));
        }
        if (
          msg.startsWith("BOARD_COLUMN_NOT_FOUND:")
          || msg.startsWith("BOARD_COLUMN_NOT_IN_BOARD:")
          || msg.startsWith("BOARD_COLUMN_NOT_IN_WORKSPACE:")
          || msg.startsWith("BOARD_COLUMN_ROLE_NOT_FOUND:")
          || msg.startsWith("BOARD_NOT_IN_WORKSPACE:")
          || msg.startsWith("PROJECT_NOT_IN_WORKSPACE:")
        ) {
          set.status = 400;
          return errorResponse(msg.replace(/^[A-Z_]+:\\s*/, ""));
        }
        throw err;
      }

      await refreshForecastsForChangedWorkItems(orgId, [item.id]);

      // Track creation event
      getActivityLogger().log({
        actorUserId: (user?.id ?? null) as string,
        workspaceId: orgId,
        action: "created",
        resourceType: "work_item",
        resourceId: item.id,
        metadata: {
          triggeredBy: getTriggeredByFromMetadata(normalizedMetadata),
          title: item.title,
          type: item.type,
          source: "web",
          processType: "manual",
          requestedByUserId: user?.id,
        },
      });

      wsConnectionManager.broadcastToWorkspace(orgId, {
        type: "work-item:created",
        payload: {
          workItemId: item.id,
          boardId: body.boardId,
          title: item.title,
          taskId: item.taskId ?? undefined,
        },
      });

      // Fire-and-forget: enqueue effort estimation for the new item + bump
      // the parent (child-added) so its estimate reflects the new child.
      enqueueEffortEstimation(item.id, "created").catch(() => {});
      if (item.parentId) {
        enqueueEffortEstimation(item.parentId, "child-added").catch(() => {});
      }

      set.status = 201;
      return successResponse(item);
    },
    {
      body: t.Object({
        id: t.Optional(t.String()),
        projectId: t.Optional(t.Nullable(t.String())),
        boardId: t.String(),
        boardColumnId: t.Optional(t.Nullable(t.String())),
        parentId: t.Optional(t.String()),
        type: t.String(),
        title: t.String(),
        description: t.Optional(t.String()),
        priority: t.Optional(t.String()),
        assignee: t.Optional(t.String()),
        position: t.Optional(t.Number()),
        dueDate: t.Optional(t.String()),
        estimatedHours: t.Optional(t.Number()),
        metadata: t.Optional(t.Record(t.String(), t.Any())),
        tagIds: t.Optional(t.Array(t.String())),
      }),
    }
  )

  // Typed create endpoints (force the work item type)
  .use(workItemsTypedCreateRoutes)

  // ── Single item routes ──────────────────────────────────────────

  // GET /work-items/:id - Get by ID
  .get(
    "/:id",
    async ({ params, set, activeWorkspace }) => {
      const orgId = activeWorkspace!.id;
      const item = await getWorkItemById(params.id, orgId);

      if (!item) {
        set.status = 404;
        return notFoundResponse("Work item");
      }

      return successResponse(item);
    },
    {
      params: t.Object({
        id: t.String(),
      }),
    }
  )

  // PATCH /work-items/:id - Update work item
  .patch(
    "/:id",
    async (ctx) => {
      const { params, body, set, activeWorkspace } = ctx;
      const user = (ctx as { user?: { id?: string } }).user;
      const orgId = activeWorkspace!.id;
      // Fetch current state to track changes
      const existing = await getWorkItemById(params.id, orgId);

      const normalizedMetadata = normalizeMetadataWithAgents(
        body.metadata as Record<string, unknown> | undefined,
        (existing?.metadata as Record<string, unknown> | undefined) ?? undefined
      );

      const item = await updateWorkItem(orgId, params.id, {
        title: body.title,
        description: body.description,
        type: body.type as typeof VALID_TYPES[number] | undefined,
        priority: body.priority as typeof VALID_PRIORITIES[number] | undefined,
        assignee: body.assignee,
        startDate: body.startDate,
        dueDate: body.dueDate,
        estimatedHours: body.estimatedHours,
        metadata: normalizedMetadata,
        tagIds: body.tagIds,
        parentId: body.parentId,
        projectId: body.projectId,
        requestedByUserId: body.requestedByUserId,
        codingAgent: body.codingAgent,
        aiModel: body.aiModel,
      });

      if (!item) {
        set.status = 404;
        return notFoundResponse("Work item");
      }

      await refreshForecastsForChangedWorkItems(orgId, [
        params.id,
        existing?.parentId,
        item.parentId,
      ]);

      if (existing && existing.assignee !== item.assignee && item.assignee) {
        notifyWorkItemAssigned({ workItemId: params.id, assignee: item.assignee });
        emailNotifyWorkItemAssigned({ workItemId: params.id, assignee: item.assignee });
      }

      const beforeUserActions = (existing?.metadata as Record<string, unknown> | null)?.userActions;
      const afterUserActions = (item.metadata as Record<string, unknown> | null)?.userActions;
      if (typeof afterUserActions === "string") {
        const next = afterUserActions.trim();
        const prev = typeof beforeUserActions === "string" ? beforeUserActions.trim() : "";
        if (next && next !== prev) {
          notifyUserActions({ workItemId: params.id, userActions: next });
          emailNotifyUserActions({ workItemId: params.id, userActions: next });
        }
      }

      // Track field-level changes as events
      if (existing) {
        const triggeredBy = getTriggeredByFromMetadata(normalizedMetadata);
        const trackableFields: Array<{ key: string; label: string }> = [
          { key: "title", label: "title" },
          { key: "description", label: "description" },
          { key: "type", label: "type" },
          { key: "priority", label: "priority" },
          { key: "assignee", label: "assignee" },
          { key: "startDate", label: "startDate" },
          { key: "dueDate", label: "dueDate" },
          { key: "estimatedHours", label: "estimatedHours" },
          { key: "parentId", label: "parentId" },
          { key: "projectId", label: "projectId" },
        ];
        for (const { key, label } of trackableFields) {
          if (key in body) {
            const oldVal = String(existing[key as keyof typeof existing] ?? "");
            const newVal = String((body as Record<string, unknown>)[key] ?? "");
            if (oldVal !== newVal) {
              getActivityLogger().log({
                actorUserId: (user?.id ?? null) as string,
                workspaceId: orgId,
                action: "updated",
                resourceType: "work_item",
                resourceId: params.id,
                metadata: {
                  triggeredBy,
                  fieldName: label,
                  oldValue: oldVal || null,
                  newValue: newVal || null,
                  source: "web",
                  processType: "manual",
                  requestedByUserId: user?.id,
                },
              });
            }
          }
        }
      }

      wsConnectionManager.broadcastToWorkspace(orgId, {
        type: "work-item:updated",
        payload: {
          workItemId: params.id,
          boardId: item.boardId ?? undefined,
          changes: body as Record<string, unknown>,
        },
      });

      // Fire-and-forget: re-enqueue effort estimation when content-hash-relevant
      // fields changed. Hash inputs are: title, description, type, parentId, childIds.
      // On parentId change we also bump both the old and new parent so their
      // estimates reflect the added/removed child.
      if (existing) {
        const contentFieldChanged =
          (body.title !== undefined && body.title !== existing.title) ||
          (body.description !== undefined && (body.description ?? null) !== (existing.description ?? null)) ||
          (body.type !== undefined && body.type !== existing.type) ||
          (body.parentId !== undefined && (body.parentId ?? null) !== (existing.parentId ?? null));

        if (contentFieldChanged) {
          enqueueEffortEstimation(params.id, "updated").catch(() => {});
        }

        if (body.parentId !== undefined && (body.parentId ?? null) !== (existing.parentId ?? null)) {
          if (existing.parentId) {
            enqueueEffortEstimation(existing.parentId, "child-removed").catch(() => {});
          }
          if (body.parentId) {
            enqueueEffortEstimation(body.parentId, "child-added").catch(() => {});
          }
        }
      }

      return successResponse(item);
    },
    {
      params: t.Object({
        id: t.String(),
      }),
      body: t.Object({
        title: t.Optional(t.String()),
        description: t.Optional(t.Nullable(t.String())),
        type: t.Optional(t.String()),
        priority: t.Optional(t.String()),
        assignee: t.Optional(t.Nullable(t.String())),
        startDate: t.Optional(t.Nullable(t.String())),
        dueDate: t.Optional(t.Nullable(t.String())),
        estimatedHours: t.Optional(t.Nullable(t.Number())),
        metadata: t.Optional(t.Record(t.String(), t.Any())),
        tagIds: t.Optional(t.Array(t.String())),
        parentId: t.Optional(t.Nullable(t.String())),
        projectId: t.Optional(t.Nullable(t.String())),
        requestedByUserId: t.Optional(t.Nullable(t.String())),
        codingAgent: t.Optional(t.Nullable(t.Union([t.Literal("codex"), t.Literal("claude-code"), t.Literal("opencode")]))),
        aiModel: t.Optional(t.Nullable(t.String())),
      }),
    }
  )

  // DELETE /work-items/:id - Delete work item
  .delete(
    "/:id",
    async ({ params, set, activeWorkspace }) => {
      const orgId = activeWorkspace!.id;
      // Fetch before deleting to get boardId for the broadcast
      const existing = await getWorkItemById(params.id, orgId);

      const deleted = await deleteWorkItem(orgId, params.id);

      if (!deleted) {
        set.status = 404;
        return notFoundResponse("Work item");
      }

      await refreshForecastsForChangedWorkItems(orgId, [existing?.parentId]);

      wsConnectionManager.broadcastToWorkspace(orgId, {
        type: "work-item:deleted",
        payload: {
          workItemId: params.id,
          boardId: existing?.boardId ?? undefined,
        },
      });

      return successResponse({ deleted: true });
    },
    {
      params: t.Object({
        id: t.String(),
      }),
    }
  )

  // ── Batch context endpoint ─────────────────────────────────────

  // GET /work-items/:id/context - Get all edit-dialog context in one request
  .get(
    "/:id/context",
    async ({ params, set, activeWorkspace }) => {
      const orgId = activeWorkspace!.id;
      const workItem = await getWorkItemById(params.id, orgId);

      if (!workItem) {
        set.status = 404;
        return notFoundResponse("Work item");
      }

      const [
        dependenciesRaw,
        dependentsRaw,
        documents,
        suggestedDocs,
        aiSessions,
        childrenResult,
        commits,
      ] = await Promise.all([
        getDependencies(params.id),
        getDependents(params.id),
        getDocumentsByWorkItemId(params.id),
        getSuggestedDocuments(params.id),
        getAiSessionsSummaryByWorkItemId(orgId, params.id),
        getWorkItems(orgId, { page: 1, limit: 100, offset: 0 }, { parentId: params.id }),
        getCommitsByWorkItemId(params.id),
      ]);

      return successResponse({
        dependencies: {
          dependencies: dependenciesRaw,
          dependents: dependentsRaw,
        },
        documents,
        suggestedDocs,
        aiSessions,
        children: childrenResult.items,
        commits,
      });
    },
    {
      params: t.Object({
        id: t.String(),
      }),
    }
  )

  // ── Sub-resource routes ─────────────────────────────────────────

  // GET /work-items/:id/resource-forecast - Compute current RAM forecast without persisting
  .get(
    "/:id/resource-forecast",
    async ({ params, set, activeWorkspace }) => {
      const orgId = activeWorkspace!.id;
      const forecast = await buildWorkItemResourceForecast(orgId, params.id);
      if (!forecast) {
        set.status = 404;
        return notFoundResponse("Work item");
      }
      return successResponse(forecast);
    },
    {
      params: t.Object({ id: t.String() }),
    }
  )

  // POST /work-items/:id/resource-forecast/recalculate - Persist RAM forecast in metadata
  .post(
    "/:id/resource-forecast/recalculate",
    async ({ params, set, activeWorkspace }) => {
      const orgId = activeWorkspace!.id;
      const forecast = await buildWorkItemResourceForecast(orgId, params.id, { persist: true });
      if (!forecast) {
        set.status = 404;
        return notFoundResponse("Work item");
      }
      return successResponse(forecast);
    },
    {
      params: t.Object({ id: t.String() }),
    }
  )

  // PATCH /work-items/:id/move - Move work item to column/position
  .patch(
    "/:id/move",
    async (ctx) => {
      const { params, body, set, activeWorkspace } = ctx;
      const user = (ctx as { user?: { id?: string } }).user;
      const orgId = activeWorkspace!.id;
      const before = await getWorkItemById(params.id, orgId);

      if (!body.boardColumnId) {
        set.status = 400;
        return errorResponse("Board column ID is required");
      }

      if (body.position === undefined || body.position === null) {
        set.status = 400;
        return errorResponse("Position is required");
      }

      // Parent-type items (epic/feature/story): cascade move to all descendant leaf tasks
      if (before && isParentType(before.type)) {
        const leafIds = await getDescendantLeafIds(params.id);
        if (leafIds.length === 0) {
          set.status = 400;
          return errorResponse(`No descendant tasks found for ${before.type} "${before.taskId ?? params.id}"`);
        }

        const beforeItems = await Promise.all(leafIds.map((id) => getWorkItemById(id, orgId)));

        let success: boolean;
        try {
          success = await bulkMoveWorkItems(orgId, leafIds, body.boardColumnId);
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          if (
            msg.startsWith("BOARD_COLUMN_NOT_FOUND:")
            || msg.startsWith("BOARD_COLUMN_ROLE_NOT_FOUND:")
          ) {
            set.status = 400;
            return errorResponse(msg.replace(/^[A-Z_]+:\\s*/, ""));
          }
          throw err;
        }

        if (!success) {
          set.status = 400;
          return errorResponse("Failed to move descendant work items");
        }

        const movedItems = await Promise.all(leafIds.map((id) => getWorkItemById(id, orgId)));

        for (const movedItem of movedItems) {
          if (!movedItem) continue;
          const beforeItem = beforeItems.find(b => b?.id === movedItem.id);
          if (beforeItem && beforeItem.boardColumnId !== movedItem.boardColumnId) {
            getActivityLogger().log({
              actorUserId: (user?.id ?? null) as string,
              workspaceId: orgId,
              action: "moved",
              resourceType: "work_item",
              resourceId: movedItem.id,
              metadata: {
                triggeredBy: "user",
                fieldName: "boardColumnId",
                oldValue: beforeItem.boardColumnId,
                newValue: movedItem.boardColumnId,
                source: "web",
                requestedByUserId: user?.id,
                processType: "manual",
                parentId: params.id,
              },
            });
          }
        }

        for (const movedItem of movedItems) {
          if (!movedItem) continue;
          wsConnectionManager.broadcastToWorkspace(orgId, {
            type: "work-item:updated",
            payload: {
              workItemId: movedItem.id,
              boardId: movedItem.boardId,
              changes: { boardColumnId: movedItem.boardColumnId },
            },
          });
        }

        // Also broadcast update for the parent so UI refreshes its virtual column
        wsConnectionManager.broadcastToWorkspace(orgId, {
          type: "work-item:updated",
          payload: {
            workItemId: params.id,
            boardId: before.boardId,
            changes: { boardColumnId: body.boardColumnId },
          },
        });

        return successResponse({ moved: true, cascaded: leafIds.length });
      }

      const moveCtx = {
        triggeredBy: "user" as const,
        triggeredByUserId: user?.id,
        provenance: { source: "web" as const, requestedByUserId: user?.id, processType: "manual" as const },
      };

      let success: boolean;
      try {
        success = await moveWorkItem(
          params.id,
          body.boardColumnId,
          body.position,
          moveCtx,
          orgId
        );
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (
          msg.startsWith("BOARD_COLUMN_NOT_FOUND:")
          || msg.startsWith("BOARD_COLUMN_NOT_IN_BOARD:")
          || msg.startsWith("BOARD_COLUMN_NOT_IN_WORKSPACE:")
          || msg.startsWith("BOARD_COLUMN_ROLE_NOT_FOUND:")
          || msg.startsWith("PARENT_TYPE_CANNOT_MOVE:")
          || msg.startsWith("INCOMPLETE_CHECKLIST:")
        ) {
          set.status = 400;
          return errorResponse(msg.replace(/^[A-Z_]+:\\s*/, ""));
        }
        throw err;
      }

      if (!success) {
        set.status = 404;
        return notFoundResponse("Work item");
      }

      // Get updated item for boardId
      const movedItem = await getWorkItemById(params.id, orgId);

      if (before && movedItem && before.boardColumnId !== movedItem.boardColumnId) {
        notifyWorkItemMoved({
          workItemId: params.id,
          fromColumnName: before.columnName ?? "",
          toColumnName: movedItem.columnName ?? "",
        });
        emailNotifyWorkItemMoved({
          workItemId: params.id,
          fromColumnName: before.columnName ?? "",
          toColumnName: movedItem.columnName ?? "",
        });

        if (/done|hecho|completed/i.test(movedItem.columnName ?? "")) {
          notifyWorkItemDone({ workItemId: params.id });
          emailNotifyWorkItemDone({ workItemId: params.id });
        }
      }

      // Track move event
      getActivityLogger().log({
        actorUserId: (user?.id ?? null) as string,
        workspaceId: orgId,
        action: "moved",
        resourceType: "work_item",
        resourceId: params.id,
        metadata: {
          triggeredBy: "user",
          fieldName: "boardColumnId",
          oldValue: before?.boardColumnId ?? null,
          newValue: movedItem?.boardColumnId ?? body.boardColumnId,
          source: "web",
          requestedByUserId: user?.id,
          processType: "manual",
        },
      });

      wsConnectionManager.broadcastToWorkspace(orgId, {
        type: "work-item:updated",
        payload: {
          workItemId: params.id,
          boardId: movedItem?.boardId ?? undefined,
          changes: {
            boardColumnId: movedItem?.boardColumnId ?? body.boardColumnId,
            position: body.position,
          },
        },
      });

      return successResponse({ moved: true });
    },
    {
      params: t.Object({
        id: t.String(),
      }),
      body: t.Object({
        boardColumnId: t.String(),
        position: t.Number(),
      }),
    }
  )

  // PATCH /work-items/:id/parent - Change parent of work item
  .patch(
    "/:id/parent",
    async ({ params, body, set, activeWorkspace }) => {
      const orgId = activeWorkspace!.id;
      const existing = await getWorkItemById(params.id, orgId);
      const success = await changeParent(orgId, params.id, body.parentId);

      if (!success) {
        set.status = 404;
        return notFoundResponse("Work item");
      }

      await refreshForecastsForChangedWorkItems(orgId, [
        params.id,
        existing?.parentId,
        body.parentId,
      ]);

      wsConnectionManager.broadcastToWorkspace(orgId, {
        type: "work-item:updated",
        payload: {
          workItemId: params.id,
          changes: { parentId: body.parentId },
        },
      });

      return successResponse({ parentId: body.parentId });
    },
    {
      params: t.Object({
        id: t.String(),
      }),
      body: t.Object({
        parentId: t.Nullable(t.String()),
      }),
    }
  )

  // POST /work-items/:id/promote - Promote an idea to a concrete work item type
  .post(
    "/:id/promote",
    async (ctx) => {
      const { params, body, set, activeWorkspace } = ctx;
      const user = (ctx as { user?: { id?: string } }).user;
      const orgId = activeWorkspace!.id;
      const item = await getWorkItemById(params.id, orgId);

      if (!item) {
        set.status = 404;
        return notFoundResponse("Work item");
      }

      if (item.type !== "idea") {
        set.status = 400;
        return errorResponse("Only ideas can be promoted");
      }

      const allowedTargetTypes = ["task", "feature", "story", "epic"] as const;
      if (!allowedTargetTypes.includes(body.targetType as typeof allowedTargetTypes[number])) {
        set.status = 400;
        return errorResponse("targetType must be one of: task, feature, story, epic");
      }

      // Update the type
      const updated = await updateWorkItem(orgId, params.id, {
        type: body.targetType as "task" | "feature" | "story" | "epic",
      });

      if (!updated) {
        set.status = 500;
        return errorResponse("Failed to promote work item");
      }

      // If boardId/boardColumnId provided, move the item
      if (body.boardColumnId) {
        try {
          await moveWorkItem(params.id, body.boardColumnId, updated.position ?? 0, undefined, orgId);
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          if (
            msg.startsWith("BOARD_COLUMN_NOT_FOUND:")
            || msg.startsWith("BOARD_COLUMN_NOT_IN_BOARD:")
            || msg.startsWith("BOARD_COLUMN_NOT_IN_WORKSPACE:")
            || msg.startsWith("BOARD_COLUMN_ROLE_NOT_FOUND:")
          ) {
            set.status = 400;
            return errorResponse(msg.replace(/^[A-Z_]+:\\s*/, ""));
          }
          throw err;
        }
      }

      // Create event for the type change
      getActivityLogger().log({
        actorUserId: (user?.id ?? null) as string,
        workspaceId: orgId,
        action: "updated",
        resourceType: "work_item",
        resourceId: params.id,
        metadata: {
          triggeredBy: "user",
          fieldName: "type",
          oldValue: "idea",
          newValue: body.targetType,
          action: "promoted",
          source: "web",
          processType: "manual",
          requestedByUserId: user?.id,
        },
      });

      wsConnectionManager.broadcastToWorkspace(orgId, {
        type: "work-item:updated",
        payload: {
          workItemId: params.id,
          boardId: updated.boardId ?? undefined,
          changes: { type: body.targetType },
        },
      });

      // Re-fetch to get latest state after potential move
      const final = await getWorkItemById(params.id, orgId);
      return successResponse(final);
    },
    {
      params: t.Object({
        id: t.String(),
      }),
      body: t.Object({
        targetType: t.String(),
        boardId: t.Optional(t.String()),
        boardColumnId: t.Optional(t.String()),
      }),
    }
  )

  // POST /work-items/:id/discard - Discard (archive) an idea
  .post(
    "/:id/discard",
    async (ctx) => {
      const { params, set, activeWorkspace } = ctx;
      const user = (ctx as { user?: { id?: string } }).user;
      const orgId = activeWorkspace!.id;
      const item = await getWorkItemById(params.id, orgId);

      if (!item) {
        set.status = 404;
        return notFoundResponse("Work item");
      }

      if (item.type !== "idea") {
        set.status = 400;
        return errorResponse("Only ideas can be discarded");
      }

      // Set archivedAt directly on the work item
      const [updated] = await db
        .update(workItems)
        .set({
          archivedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(workItems.id, params.id))
        .returning();

      if (!updated) {
        set.status = 500;
        return errorResponse("Failed to discard work item");
      }

      // Create event for the archive
      getActivityLogger().log({
        actorUserId: (user?.id ?? null) as string,
        workspaceId: orgId,
        action: "updated",
        resourceType: "work_item",
        resourceId: params.id,
        metadata: {
          triggeredBy: "user",
          fieldName: "archivedAt",
          oldValue: null,
          newValue: updated.archivedAt?.toISOString() ?? null,
          action: "discarded",
          source: "web",
          processType: "manual",
          requestedByUserId: user?.id,
        },
      });

      wsConnectionManager.broadcastToWorkspace(orgId, {
        type: "work-item:updated",
        payload: {
          workItemId: params.id,
          boardId: item.boardId ?? undefined,
          changes: { archivedAt: updated.archivedAt?.toISOString() },
        },
      });

      return successResponse({ discarded: true });
    },
    {
      params: t.Object({
        id: t.String(),
      }),
    }
  )

  // PATCH /work-items/:id/reset-ai - Clear stuck AI processing state
  .patch(
    "/:id/reset-ai",
    async ({ params, set, activeWorkspace }) => {
      const orgId = activeWorkspace!.id;
      const existing = await getWorkItemById(params.id, orgId);
      if (!existing) {
        set.status = 404;
        return notFoundResponse("Work item");
      }

      const cleared = await clearWorkItemAiState(params.id);
      if (!cleared) {
        set.status = 500;
        return errorResponse("Failed to clear AI processing state");
      }

      wsConnectionManager.broadcastToWorkspace(orgId, {
        type: "work-item:updated",
        payload: {
          workItemId: params.id,
          boardId: existing.boardId ?? undefined,
          changes: { isAiProcessing: false },
        },
      });

      return successResponse({ reset: true });
    },
    {
      params: t.Object({
        id: t.String(),
      }),
    }
  )

  // PATCH /work-items/:id/prompt - Save generated prompt to metadata
  .patch(
    "/:id/prompt",
    async ({ params, body, set, activeWorkspace }) => {
      const orgId = activeWorkspace!.id;
      if (!body.prompt || body.prompt.trim() === "") {
        set.status = 400;
        return errorResponse("Prompt is required");
      }

      const success = await saveGeneratedPrompt(orgId, params.id, body.prompt);

      if (!success) {
        set.status = 404;
        return notFoundResponse("Work item");
      }

      return successResponse({ saved: true });
    },
    {
      params: t.Object({
        id: t.String(),
      }),
      body: t.Object({
        prompt: t.String(),
      }),
    }
  )

  // GET /work-items/:id/prompt - Retrieve stored generated prompt
  .get(
    "/:id/prompt",
    async ({ params, set, activeWorkspace }) => {
      const orgId = activeWorkspace!.id;
      const workItem = await getWorkItemById(params.id, orgId);

      if (!workItem) {
        set.status = 404;
        return notFoundResponse("Work item");
      }

      const metadata = workItem.metadata as Record<string, unknown> | null;
      const generatedPrompt = metadata?.generatedPrompt;

      if (!generatedPrompt) {
        set.status = 404;
        return errorResponse("No generated prompt found for this work item");
      }

      return successResponse({
        prompt: generatedPrompt,
        context: {
          workItemId: workItem.id,
          taskId: workItem.taskId,
          title: workItem.title,
          type: workItem.type,
        },
        generatedAt: metadata?.promptGeneratedAt ?? null,
      });
    },
    {
      params: t.Object({
        id: t.String(),
      }),
    }
  )

  // POST /work-items/:id/generate-prompt - Generate enriched prompt with project context
  .post(
    "/:id/generate-prompt",
    async (ctx) => {
      const { params, body, set, activeWorkspace } = ctx;
      const user = (ctx as { user?: { locale?: string } }).user;
      const locale = user?.locale ?? "es";
      const orgId = activeWorkspace!.id;
      if (!body.providerKeyId && !isAiConfigured()) {
        set.status = 503;
        return errorResponse("AI service is not configured");
      }

      const context = await gatherWorkItemContext(params.id, orgId);
      if (!context) {
        set.status = 404;
        return notFoundResponse("Work item");
      }

      let model: BaseChatModel | undefined;
      let connectionId: string | undefined;
      if (body.providerKeyId) {
        try {
          const resolved = await resolveModelFromProviderKey(body.providerKeyId);
          model = resolved.model;
          connectionId = resolved.connectionId;
        } catch (err) {
          logger.error({ error: err, keyId: body.providerKeyId }, "Failed to resolve provider key");
          set.status = 400;
          return errorResponse(
            err instanceof Error ? err.message : "Failed to resolve provider API key"
          );
        }
      }

      try {
        const enrichedInput = buildEnrichedPromptInput(context);
        const runFormat = () => formatText(enrichedInput, "prompt", model, locale);
        const generatedPrompt = connectionId
          ? await withAuthErrorDetection(connectionId, runFormat)
          : await runFormat();

        const saved = await saveGeneratedPrompt(orgId, params.id, generatedPrompt);

        if (saved) {
          wsConnectionManager.broadcastToWorkspace(orgId, {
            type: "work-item:updated",
            payload: {
              workItemId: params.id,
              changes: { generatedPrompt },
            },
          });
        }

        set.status = 201;
        return successResponse({
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
        });
      } catch (error) {
        logger.error(error, "Error generating prompt for work item");
        set.status = 500;
        return errorResponse("Error generating prompt with AI", 500);
      }
    },
    {
      params: t.Object({
        id: t.String(),
      }),
      body: t.Object({
        providerKeyId: t.Optional(t.String()),
      }),
    }
  )

  // POST /work-items/:id/generate-docs - Generate AI documentation for a completed task
  .post(
    "/:id/generate-docs",
    async (ctx) => {
      const { params, body, set, activeWorkspace } = ctx;
      const user = (ctx as { user?: { locale?: string } }).user;
      const locale = user?.locale ?? "es";
      const orgId = activeWorkspace!.id;
      if (!body.providerKeyId && !isAiConfigured()) {
        set.status = 503;
        return errorResponse("AI service is not configured. Set OPENAI_API_KEY.", 503);
      }

      const workItem = await getWorkItemById(params.id, orgId);
      if (!workItem) {
        set.status = 404;
        return notFoundResponse("Work item");
      }

      let model: BaseChatModel | undefined;
      let docsConnectionId: string | undefined;
      if (body.providerKeyId) {
        try {
          const resolved = await resolveModelFromProviderKey(body.providerKeyId);
          model = resolved.model;
          docsConnectionId = resolved.connectionId;
        } catch (err) {
          logger.error({ error: err, keyId: body.providerKeyId }, "Failed to resolve provider key");
          set.status = 400;
          return errorResponse(
            err instanceof Error ? err.message : "Failed to resolve provider API key"
          );
        }
      }

      try {
        const metadata = workItem.metadata as Record<string, unknown> | null;
        const definitionOfDone = (metadata?.definitionOfDone as string) ?? null;

        const runDocs = () => generateDocumentation({
          title: workItem.title,
          description: workItem.description ?? null,
          definitionOfDone,
        }, model, locale);
        const content = docsConnectionId
          ? await withAuthErrorDetection(docsConnectionId, runDocs)
          : await runDocs();

        const doc = await createDocument(orgId, {
          title: `Documentación: ${workItem.title}`,
          content,
          projectId: workItem.projectId ?? undefined,
        });

        if (!doc) {
          set.status = 500;
          return errorResponse("Error creating document");
        }

        await linkDocumentToWorkItem(doc.id, params.id);

        set.status = 201;
        return successResponse({
          document: {
            id: doc.id,
            title: doc.title,
            projectId: doc.projectId,
          },
        });
      } catch (error) {
        logger.error(error, "Error generating documentation for work item");
        set.status = 500;
        return errorResponse("Error generating documentation with AI");
      }
    },
    {
      params: t.Object({
        id: t.String(),
      }),
      body: t.Object({
        providerKeyId: t.Optional(t.String()),
      }),
    }
  )

  // ── Attachment routes ─────────────────────────────────────────

  // GET /work-items/:id/attachments - List attachments
  .get(
    "/:id/attachments",
    async ({ params, activeWorkspace }) => {
      const orgId = activeWorkspace!.id;
      const attachments = await getAttachmentsByWorkItem(orgId, params.id);
      return successResponse(attachments);
    },
    {
      params: t.Object({
        id: t.String(),
      }),
    }
  )

  // GET /work-items/:id/attachments/local?key=... - Serve locally-stored attachment (S3 fallback)
  .get(
    "/:id/attachments/local",
    async ({ params, query, set }) => {
      const key = query.key;
      if (!key) {
        set.status = 400;
        return errorResponse("key is required");
      }

      // Prevent path traversal and cross-work-item leakage.
      const expectedPrefix = `work-items/${params.id}/`;
      if (!key.startsWith(expectedPrefix)) {
        set.status = 400;
        return errorResponse("Invalid key");
      }

      try {
        const filePath = resolveLocalAttachmentPath(key);
        const file = Bun.file(filePath);
        if (!(await file.exists())) {
          set.status = 404;
          return notFoundResponse("Attachment file");
        }

        const contentType = inferMimeTypeFromName(key);
        return new Response(file, {
          headers: {
            "Content-Type": contentType,
            "Cache-Control": "private, max-age=0",
          },
        });
      } catch (err) {
        logger.error(err, "Failed to serve local attachment");
        set.status = 500;
        return errorResponse("Failed to serve attachment");
      }
    },
    {
      params: t.Object({
        id: t.String(),
      }),
      query: t.Object({
        key: t.String(),
      }),
    }
  )

  // POST /work-items/:id/attachments - Upload attachment
  .post(
    "/:id/attachments",
    async ({ params, body, set, activeWorkspace }) => {
      const orgId = activeWorkspace!.id;
      const file = body.file;
      if (!file) {
        set.status = 400;
        return errorResponse("File is required");
      }

      let attachmentMetadata: Record<string, unknown> = {};
      if (body.metadata) {
        try {
          attachmentMetadata = JSON.parse(body.metadata) as Record<string, unknown>;
        } catch {
          set.status = 400;
          return errorResponse("metadata must be valid JSON");
        }
      }

      let buffer: Buffer<ArrayBufferLike> = Buffer.from(await file.arrayBuffer() as ArrayBuffer);
      let fileName = file.name;
      let mimeType = file.type || inferMimeTypeFromName(fileName);

      // Best-effort compression for review screenshots (avoid bloating attachments)
      // Skip compression entirely for video files - they use their own codecs.
      const isVideo = mimeType.startsWith("video/");
      const isReviewScreenshot = attachmentMetadata.kind === "review-screenshot";
      if (isReviewScreenshot && !isVideo && buffer.length > 2_000_000) {
        try {
          // Optional dependency: only used when installed.
          const sharpMod = await import("sharp");
          const sharp = sharpMod.default;

          // Try better PNG compression first.
          if (mimeType === "image/png") {
            const next = await sharp(buffer)
              .png({ compressionLevel: 9, palette: true, quality: 80 })
              .toBuffer();
            if (next.length < buffer.length) buffer = next;
          }

          // If still too large, convert to JPEG (tradeoff: not lossless).
          if (buffer.length > 2_000_000) {
            const next = await sharp(buffer)
              .jpeg({ quality: 75, mozjpeg: true })
              .toBuffer();
            buffer = next;
            mimeType = "image/jpeg";
            fileName = fileName.replace(/\.png$/i, ".jpg");
          }
        } catch {
          // If sharp isn't available, keep the original buffer.
        }
      }

      const key = generateAttachmentKey(params.id, fileName);
      const storageMetadata: Record<string, unknown> = {};
      let fileUrl: string;

      if (isS3Configured()) {
        fileUrl = await uploadBufferToS3(buffer, key, mimeType);
        storageMetadata.storage = "s3";
        storageMetadata.key = key;
      } else {
        await writeLocalAttachment(key, buffer);
        fileUrl = `/api/work-items/${params.id}/attachments/local?key=${encodeURIComponent(key)}`;
        storageMetadata.storage = "local";
        storageMetadata.key = key;
      }

      const attachment = await createAttachment(orgId, {
        workItemId: params.id,
        fileName,
        fileUrl,
        fileSize: buffer.length,
        mimeType,
        uploadedBy: body.uploadedBy ?? undefined,
        metadata: { ...attachmentMetadata, ...storageMetadata },
      });

      set.status = 201;
      return successResponse(attachment);
    },
    {
      params: t.Object({
        id: t.String(),
      }),
      body: t.Object({
        file: t.File(),
        uploadedBy: t.Optional(t.String()),
        // JSON encoded to keep multipart upload simple.
        metadata: t.Optional(t.String()),
      }),
    }
  )

  // DELETE /work-items/:id/attachments/:attachmentId - Delete attachment
  .delete(
    "/:id/attachments/:attachmentId",
    async ({ params, set, activeWorkspace }) => {
      const orgId = activeWorkspace!.id;
      const attachment = await getAttachment(orgId, params.attachmentId);
      if (!attachment) {
        set.status = 404;
        return notFoundResponse("Attachment");
      }

      const meta = (attachment.metadata ?? {}) as Record<string, unknown>;
      const storage = meta.storage;
      const key = typeof meta.key === "string" ? meta.key : extractKeyFromUrl(attachment.fileUrl);

      if (storage === "local" && typeof key === "string") {
        try {
          await deleteLocalAttachment(key);
        } catch {
          // Best-effort; still delete DB record.
        }
      } else if (typeof key === "string" && isS3Configured()) {
        try {
          await deleteFromS3(key);
        } catch (err) {
          // Log but don't fail - the DB record should still be deleted
          console.error("Failed to delete from S3:", err);
        }
      }

      const deleted = await deleteAttachment(orgId, params.attachmentId);
      if (!deleted) {
        set.status = 500;
        return errorResponse("Failed to delete attachment");
      }

      return successResponse({ deleted: true });
    },
    {
      params: t.Object({
        id: t.String(),
        attachmentId: t.String(),
      }),
    }
  )

  // ── Event history routes ───────────────────────────────────────

  // GET /work-items/:id/events - List event history with pagination and filters
  .get(
    "/:id/events",
    async ({ params, query }) => {
      const pagination = parsePaginationParams(query);
      const hasDateRange = query.startDate && query.endDate;

      let events;

      if (hasDateRange) {
        events = await getEventsByDateRange(
          new Date(query.startDate!),
          new Date(query.endDate!),
          {
            workItemId: params.id,
            eventType: query.eventType || undefined,
          }
        );
      } else {
        events = await getWorkItemEventsByWorkItemId(params.id, {
          eventType: query.eventType || undefined,
          limit: pagination.limit,
          offset: pagination.offset,
        });
      }

      const total = events.length;
      let paginatedEvents = events;

      // getEventsByDateRange does not support limit/offset natively, so paginate in-memory
      if (hasDateRange) {
        paginatedEvents = events.slice(pagination.offset, pagination.offset + pagination.limit);
      }

      // Enrich moved events: resolve boardColumnId UUIDs into human-readable column names.
      const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
      const columnIdsToResolve = new Set<string>();
      for (const ev of paginatedEvents) {
        if (ev.fieldName !== "boardColumnId") continue;
        if (typeof ev.oldValue === "string" && uuidRegex.test(ev.oldValue)) {
          columnIdsToResolve.add(ev.oldValue);
        }
        if (typeof ev.newValue === "string" && uuidRegex.test(ev.newValue)) {
          columnIdsToResolve.add(ev.newValue);
        }
      }

      if (columnIdsToResolve.size > 0) {
        const cols = await getBoardColumnsByIds(Array.from(columnIdsToResolve));
        const nameById = new Map(cols.map((c) => [c.id, c.name]));
        paginatedEvents = paginatedEvents.map((ev) => {
          if (ev.fieldName !== "boardColumnId") return ev;
          const oldValue =
            typeof ev.oldValue === "string" && nameById.has(ev.oldValue)
              ? nameById.get(ev.oldValue)!
              : ev.oldValue;
          const newValue =
            typeof ev.newValue === "string" && nameById.has(ev.newValue)
              ? nameById.get(ev.newValue)!
              : ev.newValue;
          return { ...ev, oldValue, newValue };
        });
      }

      // Enrich events with user data (name, image, email)
      const userIdsToResolve = new Set<string>();
      for (const ev of paginatedEvents) {
        if (ev.triggeredByUserId) userIdsToResolve.add(ev.triggeredByUserId);
      }

      const userMap = new Map<string, { name: string; image: string | null; email: string }>();
      if (userIdsToResolve.size > 0) {
        const users = await Promise.all(
          Array.from(userIdsToResolve).map((id) => getUserById(id))
        );
        for (const u of users) {
          if (u) userMap.set(u.id, { name: u.name, image: u.image, email: u.email });
        }
      }

      const enrichedEvents = paginatedEvents.map((ev) => {
        const userData = ev.triggeredByUserId ? userMap.get(ev.triggeredByUserId) : null;
        return {
          ...ev,
          triggeredByUserName: userData?.name ?? null,
          triggeredByUserImage: userData?.image ?? null,
          triggeredByUserEmail: userData?.email ?? null,
        };
      });

      const meta = buildPaginationMeta(pagination.page, pagination.limit, total);

      return successResponse(enrichedEvents, meta);
    },
    {
      params: t.Object({
        id: t.String(),
      }),
      query: t.Object({
        page: t.Optional(t.String()),
        limit: t.Optional(t.String()),
        eventType: t.Optional(t.String()),
        startDate: t.Optional(t.String()),
        endDate: t.Optional(t.String()),
      }),
    }
  )

  // GET /work-items/:id/agent-actions - List agent action history
  .get(
    "/:id/agent-actions",
    async ({ params, query }) => {
      const pagination = parsePaginationParams(query);
      const events = await getAgentActionsByWorkItemId(params.id, {
        limit: pagination.limit,
        offset: pagination.offset,
      });
      return successResponse(events, buildPaginationMeta(pagination.page, pagination.limit, events.length));
    },
    {
      params: t.Object({ id: t.String() }),
      query: t.Object({
        page: t.Optional(t.String()),
        limit: t.Optional(t.String()),
      }),
    }
  )

  // GET /work-items/:id/children-events - Batch list events from direct children
  .get(
    "/:id/children-events",
    async ({ params, query, set }) => {
      const children = await getDirectChildrenBasic(params.id);

      if (children.length === 0) {
        return successResponse([]);
      }

      const childIds = children.map((c) => c.id);

      // Get taskIds for each child work item
      const childRows = await db
        .select({ id: workItems.id, taskId: workItems.taskId })
        .from(workItems)
        .where(inArray(workItems.id, childIds));

      const taskIdMap = new Map<string, string | null>();
      for (const row of childRows) {
        taskIdMap.set(row.id, row.taskId);
      }

      const limitNum = query.limit ? Math.min(parseInt(query.limit, 10), 200) : 50;

      let events;
      try {
        events = await getEventsByWorkItemIds(childIds, {
          limit: limitNum,
          eventType: query.eventType || undefined,
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (msg.includes("Maximum 100")) {
          set.status = 400;
          return errorResponse("Too many children to fetch events for (max 100)");
        }
        throw err;
      }

      // Enrich moved events: resolve boardColumnId UUIDs into human-readable column names.
      const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
      const columnIdsToResolve = new Set<string>();
      const projectIdsToResolve = new Set<string>();
      for (const ev of events) {
        if (ev.fieldName === "boardColumnId") {
          if (typeof ev.oldValue === "string" && uuidRegex.test(ev.oldValue)) {
            columnIdsToResolve.add(ev.oldValue);
          }
          if (typeof ev.newValue === "string" && uuidRegex.test(ev.newValue)) {
            columnIdsToResolve.add(ev.newValue);
          }
        }
        if (ev.fieldName === "projectId") {
          if (typeof ev.oldValue === "string" && uuidRegex.test(ev.oldValue)) {
            projectIdsToResolve.add(ev.oldValue);
          }
          if (typeof ev.newValue === "string" && uuidRegex.test(ev.newValue)) {
            projectIdsToResolve.add(ev.newValue);
          }
        }
      }

      const columnNameById = new Map<string, string>();
      if (columnIdsToResolve.size > 0) {
        const cols = await getBoardColumnsByIds(Array.from(columnIdsToResolve));
        for (const c of cols) columnNameById.set(c.id, c.name);
      }

      const projectNameById = new Map<string, string>();
      if (projectIdsToResolve.size > 0) {
        const projs = await db
          .select({ id: projects.id, name: projects.name })
          .from(projects)
          .where(inArray(projects.id, Array.from(projectIdsToResolve)));
        for (const p of projs) projectNameById.set(p.id, p.name);
      }

      let resolvedEvents = events.map((ev) => {
        if (ev.fieldName === "boardColumnId") {
          const oldValue =
            typeof ev.oldValue === "string" && columnNameById.has(ev.oldValue)
              ? columnNameById.get(ev.oldValue)!
              : ev.oldValue;
          const newValue =
            typeof ev.newValue === "string" && columnNameById.has(ev.newValue)
              ? columnNameById.get(ev.newValue)!
              : ev.newValue;
          return { ...ev, oldValue, newValue };
        }
        if (ev.fieldName === "projectId") {
          const oldValue =
            typeof ev.oldValue === "string" && projectNameById.has(ev.oldValue)
              ? projectNameById.get(ev.oldValue)!
              : ev.oldValue;
          const newValue =
            typeof ev.newValue === "string" && projectNameById.has(ev.newValue)
              ? projectNameById.get(ev.newValue)!
              : ev.newValue;
          return { ...ev, oldValue, newValue };
        }
        return ev;
      });

      // Enrich events with user data (name, image, email)
      const userIdsToResolve = new Set<string>();
      for (const ev of resolvedEvents) {
        if (ev.triggeredByUserId) userIdsToResolve.add(ev.triggeredByUserId);
      }

      const userMap = new Map<string, { name: string; image: string | null; email: string }>();
      if (userIdsToResolve.size > 0) {
        const users = await Promise.all(
          Array.from(userIdsToResolve).map((id) => getUserById(id))
        );
        for (const u of users) {
          if (u) userMap.set(u.id, { name: u.name, image: u.image, email: u.email });
        }
      }

      const enrichedEvents = resolvedEvents.map((ev) => {
        const userData = ev.triggeredByUserId ? userMap.get(ev.triggeredByUserId) : null;
        return {
          ...ev,
          taskId: taskIdMap.get(ev.workItemId) ?? null,
          triggeredByUserName: userData?.name ?? null,
          triggeredByUserImage: userData?.image ?? null,
          triggeredByUserEmail: userData?.email ?? null,
        };
      });

      return successResponse(enrichedEvents);
    },
    {
      params: t.Object({
        id: t.String(),
      }),
      query: t.Object({
        limit: t.Optional(t.String()),
        eventType: t.Optional(t.String()),
      }),
    }
  )

  // ── Dependency routes ─────────────────────────────────────────

  // GET /work-items/:id/dependencies - List what blocks this item
  .get(
    "/:id/dependencies",
    async ({ params }) => {
      const dependencies = await getDependencies(params.id);
      const dependents = await getDependents(params.id);
      return successResponse({ dependencies, dependents });
    },
    {
      params: t.Object({
        id: t.String(),
      }),
    }
  )

  // POST /work-items/:id/dependencies - Add a dependency
  .post(
    "/:id/dependencies",
    async ({ params, body, set, activeWorkspace }) => {
      const orgId = activeWorkspace!.id;
      if (!body.blockedByWorkItemId) {
        set.status = 400;
        return errorResponse("blockedByWorkItemId is required");
      }

      if (params.id === body.blockedByWorkItemId) {
        set.status = 400;
        return errorResponse("A work item cannot depend on itself");
      }

      try {
        const dependency = await addDependency(params.id, body.blockedByWorkItemId);

        await refreshForecastsForChangedWorkItems(orgId, [
          params.id,
          body.blockedByWorkItemId,
        ]);

        wsConnectionManager.broadcastToWorkspace(orgId, {
          type: "work-item:updated",
          payload: {
            workItemId: params.id,
            changes: { dependencyAdded: body.blockedByWorkItemId },
          },
        });

        set.status = 201;
        return successResponse(dependency);
      } catch (error) {
        if (error instanceof Error && error.message.includes("unique")) {
          set.status = 409;
          return errorResponse("This dependency already exists");
        }
        throw error;
      }
    },
    {
      params: t.Object({
        id: t.String(),
      }),
      body: t.Object({
        blockedByWorkItemId: t.String(),
      }),
    }
  )

  // DELETE /work-items/:id/dependencies/:blockedById - Remove a dependency
  .delete(
    "/:id/dependencies/:blockedById",
    async ({ params, set, activeWorkspace }) => {
      const orgId = activeWorkspace!.id;
      const deleted = await removeDependency(params.id, params.blockedById);

      if (!deleted) {
        set.status = 404;
        return notFoundResponse("Dependency");
      }

      await refreshForecastsForChangedWorkItems(orgId, [
        params.id,
        params.blockedById,
      ]);

      wsConnectionManager.broadcastToWorkspace(orgId, {
        type: "work-item:updated",
        payload: {
          workItemId: params.id,
          changes: { dependencyRemoved: params.blockedById },
        },
      });

      return successResponse({ deleted: true });
    },
    {
      params: t.Object({
        id: t.String(),
        blockedById: t.String(),
      }),
    }
  )

  // ── Commit linking routes ─────────────────────────────────────

  // GET /work-items/:id/commits - List linked commits
  .get(
    "/:id/commits",
    async ({ params }) => {
      const commits = await getCommitsByWorkItemId(params.id);
      return successResponse(commits);
    },
    {
      params: t.Object({
        id: t.String(),
      }),
    }
  )

  // POST /work-items/:id/commits - Link a commit manually
  .post(
    "/:id/commits",
    async ({ params, body, set, activeWorkspace }) => {
      const orgId = activeWorkspace!.id;

      if (!body.commitId) {
        set.status = 400;
        return errorResponse("commitId is required");
      }

      try {
        const link = await linkCommitToWorkItem(params.id, body.commitId, false);

        if (!link) {
          set.status = 409;
          return errorResponse("This commit is already linked to this work item");
        }

        wsConnectionManager.broadcastToWorkspace(orgId, {
          type: "work-item:updated",
          payload: {
            workItemId: params.id,
            changes: { commitLinked: body.commitId },
          },
        });

        set.status = 201;
        return successResponse(link);
      } catch (error) {
        if (error instanceof Error && error.message.includes("unique")) {
          set.status = 409;
          return errorResponse("This commit is already linked to this work item");
        }
        throw error;
      }
    },
    {
      params: t.Object({
        id: t.String(),
      }),
      body: t.Object({
        commitId: t.String(),
      }),
    }
  )

  // DELETE /work-items/:id/commits/:commitId - Unlink a commit
  .delete(
    "/:id/commits/:commitId",
    async ({ params, set, activeWorkspace }) => {
      const orgId = activeWorkspace!.id;
      const deleted = await unlinkCommitFromWorkItem(params.id, params.commitId);

      if (!deleted) {
        set.status = 404;
        return notFoundResponse("Commit link");
      }

      wsConnectionManager.broadcastToWorkspace(orgId, {
        type: "work-item:updated",
        payload: {
          workItemId: params.id,
          changes: { commitUnlinked: params.commitId },
        },
      });

      return successResponse({ deleted: true });
    },
    {
      params: t.Object({
        id: t.String(),
        commitId: t.String(),
      }),
    }
  )

  // ── Document linking routes ─────────────────────────────────────

  // GET /work-items/:id/documents - List linked documents
  .get(
    "/:id/documents",
    async ({ params }) => {
      const documents = await getDocumentsByWorkItemId(params.id);
      return successResponse(documents);
    },
    {
      params: t.Object({
        id: t.String(),
      }),
    }
  )

  // POST /work-items/:id/documents - Link a document
  .post(
    "/:id/documents",
    async ({ params, body, set }) => {
      if (!body.documentId) {
        set.status = 400;
        return errorResponse("documentId is required");
      }

      try {
        const link = await linkDocumentToWorkItem(body.documentId, params.id);

        set.status = 201;
        return successResponse(link);
      } catch (error) {
        if (error instanceof Error && error.message.includes("unique")) {
          set.status = 409;
          return errorResponse("This document is already linked to this work item");
        }
        throw error;
      }
    },
    {
      params: t.Object({
        id: t.String(),
      }),
      body: t.Object({
        documentId: t.String(),
      }),
    }
  )

  // DELETE /work-items/:id/documents/:documentId - Unlink a document
  .delete(
    "/:id/documents/:documentId",
    async ({ params, set }) => {
      const deleted = await unlinkDocumentFromWorkItem(params.documentId, params.id);

      if (!deleted) {
        set.status = 404;
        return notFoundResponse("Document link");
      }

      return successResponse({ deleted: true });
    },
    {
      params: t.Object({
        id: t.String(),
        documentId: t.String(),
      }),
    }
  )

  // ── Suggested documents routes ─────────────────────────────────

  // GET /work-items/:id/suggested-docs - Get suggested documents based on keyword matching
  .get(
    "/:id/suggested-docs",
    async ({ params }) => {
      const suggestions = await getSuggestedDocuments(params.id);
      return successResponse(suggestions);
    },
    {
      params: t.Object({
        id: t.String(),
      }),
    }
  )

  // ── AI Session routes ───────────────────────────────────────────

  // GET /work-items/:id/ai-sessions - List AI sessions with summary
  .get(
    "/:id/sessions",
    async (ctx) => {
      const { params, set } = ctx;
      const orgId = (ctx as { activeWorkspace?: { id: string } }).activeWorkspace?.id;
      if (!orgId) {
        set.status = 401;
        return errorResponse("Unauthorized");
      }

      const workItem = await getWorkItemById(params.id, orgId);
      if (!workItem) {
        set.status = 404;
        return notFoundResponse("Work item");
      }

      const sessions = await getJobsByWorkItem(params.id);

      // Enrich with provenance fields from config JSONB
      const enriched = sessions.map((job) => {
        const config = job.config as AgentJobConfig | null;
        return {
          ...job,
          source: config?.source ?? null,
          requestedByUserId: config?.requestedByUserId ?? job.createdByUserId ?? null,
          planningSessionId: config?.planningSessionId ?? job.planningSessionId ?? null,
          skillName: config?.skillName ?? null,
          sessionMode: config?.sessionMode ?? null,
        };
      });

      return successResponse(enriched);
    },
    {
      params: t.Object({
        id: t.String(),
      }),
    }
  )

  // GET /work-items/:id/ai-sessions - List AI sessions with summary
  .get(
    "/:id/ai-sessions",
    async (ctx) => {
      const { params } = ctx;
      const orgId = (ctx as { activeWorkspace?: { id: string } }).activeWorkspace!.id;
      const result = await getAiSessionsSummaryByWorkItemId(orgId, params.id);
      return successResponse(result);
    },
    {
      params: t.Object({
        id: t.String(),
      }),
    }
  )

  // POST /work-items/:id/ai-sessions - Record a new AI session
  .post(
    "/:id/ai-sessions",
    async (ctx) => {
      const { params, body, set } = ctx;
      const user = (ctx as { user?: { id?: string } }).user;
      const orgId = (ctx as { activeWorkspace?: { id: string } }).activeWorkspace!.id;
      const existing = await getWorkItemById(params.id, orgId);

      const provider = inferAiProvider(body.model, body.provider);
      const computedCost = calculateCostUsd({
        provider,
        model: body.model,
        inputTokens: body.inputTokens,
        outputTokens: body.outputTokens,
      });
      const estimatedCost = computedCost ?? body.estimatedCost ?? 0;

      const session = await createAiSession(orgId, {
        workItemId: params.id,
        model: body.model,
        provider,
        inputTokens: body.inputTokens,
        outputTokens: body.outputTokens,
        totalTokens: body.totalTokens,
        estimatedCost: String(estimatedCost),
        durationMs: body.durationMs,
        sessionType: body.sessionType ?? "implement",
        metadata: {
          ...(body.metadata ?? {}),
          source: "web",
          ...(user?.id ? { requestedByUserId: user.id } : {}),
        },
      });

      await recordQuotaUsage(orgId, provider, body.totalTokens, estimatedCost);

      // Persist provider/model on the work item for correct provider icon rendering in the UI.
      const existingMetadata = (existing?.metadata as Record<string, unknown> | undefined) ?? {};
      const inferredManagedBy =
        provider === "openai" ? "codex" : provider === "anthropic" ? "claude-code" : undefined;

      const incomingMetadata: Record<string, unknown> = {
        ...existingMetadata,
        aiProvider: provider,
        aiModel: body.model,
        ...(inferredManagedBy ? { managedBy: inferredManagedBy } : {}),
      };

      const normalizedMetadata = normalizeMetadataWithAgents(incomingMetadata, existingMetadata);

      if (normalizedMetadata) {
        await updateWorkItem(orgId, params.id, { metadata: normalizedMetadata });
        // Fire-and-forget: propagate provider to parent work item
        void propagateProviderToParent(orgId, params.id, normalizedMetadata);
      }

      // Notify connected clients (best-effort). This lets the UI show a toast without polling.
      if (user?.id) {
        wsConnectionManager.sendToUser(user.id, {
          type: "ai:session-recorded",
          payload: {
            workItemId: params.id,
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
      }

      set.status = 201;
      return successResponse(session);
    },
    {
      params: t.Object({
        id: t.String(),
      }),
      body: t.Object({
        model: t.String(),
        provider: t.Optional(t.String()),
        inputTokens: t.Number(),
        outputTokens: t.Number(),
        totalTokens: t.Number(),
        estimatedCost: t.Optional(t.Number()),
        durationMs: t.Optional(t.Number()),
        sessionType: t.Optional(t.String()),
        metadata: t.Optional(t.Record(t.String(), t.Unknown())),
      }),
    }
  )

  // ── Provenance routes ──────────────────────────────────────────────

  // GET /work-items/:id/provenance - Aggregated provenance (origin, active run, history)
  .get(
    "/:id/provenance",
    async (ctx) => {
      const { params, set } = ctx;
      const orgId = (ctx as { activeWorkspace?: { id: string } }).activeWorkspace?.id;
      if (!orgId) {
        set.status = 401;
        return errorResponse("Unauthorized");
      }

      const workItem = await getWorkItemById(params.id, orgId);
      if (!workItem) {
        set.status = 404;
        return notFoundResponse("Work item");
      }

      const provenance = await getWorkItemProvenance(orgId, params.id);
      return successResponse(provenance);
    },
    {
      params: t.Object({
        id: t.String(),
      }),
    }
  )

  // ── Worker Interaction routes ─────────────────────────────────────

  // GET /work-items/:id/interactions - List interactions for a work item
  .get(
    "/:id/interactions",
    async ({ params }) => {
      const interactions = await getInteractionsByWorkItemId(params.id);
      return successResponse(interactions);
    },
    {
      params: t.Object({
        id: t.String(),
      }),
    }
  )

  // ── Assignee routes ─────────────────────────────────────────────────

  // GET /work-items/:id/assignees - List assignees for a work item
  .get(
    "/:id/assignees",
    async ({ params }) => {
      const assignees = await getAssigneesByWorkItem(params.id);
      return successResponse(assignees);
    },
    {
      params: t.Object({
        id: t.String(),
      }),
    }
  )

  // POST /work-items/:id/assignees - Assign a user to a work item
  .post(
    "/:id/assignees",
    async ({ params, body, set }) => {
      const assignee = await assignUserToWorkItem(
        params.id,
        body.userId,
        body.role ?? "responsible"
      );

      if (!assignee) {
        set.status = 409;
        return errorResponse("User is already assigned to this work item");
      }

      set.status = 201;
      return successResponse(assignee);
    },
    {
      params: t.Object({
        id: t.String(),
      }),
      body: t.Object({
        userId: t.String(),
        role: t.Optional(
          t.Union([
            t.Literal("responsible"),
            t.Literal("collaborator"),
            t.Literal("reviewer"),
          ])
        ),
      }),
    }
  )

  // PATCH /work-items/:id/assignees/:userId - Update assignee role
  .patch(
    "/:id/assignees/:userId",
    async ({ params, body }) => {
      const updated = await updateAssigneeRole(
        params.id,
        params.userId,
        body.role
      );

      if (!updated) {
        return notFoundResponse("Assignee not found");
      }

      return successResponse(updated);
    },
    {
      params: t.Object({
        id: t.String(),
        userId: t.String(),
      }),
      body: t.Object({
        role: t.Union([
          t.Literal("responsible"),
          t.Literal("collaborator"),
          t.Literal("reviewer"),
        ]),
      }),
    }
  )

  // DELETE /work-items/:id/assignees/:userId - Unassign a user
  .delete(
    "/:id/assignees/:userId",
    async ({ params }) => {
      const removed = await unassignUserFromWorkItem(params.id, params.userId);

      if (!removed) {
        return notFoundResponse("Assignee not found");
      }

      return successResponse({ removed: true });
    },
    {
      params: t.Object({
        id: t.String(),
        userId: t.String(),
      }),
    }
  );

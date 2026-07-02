import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  addTagToIdeaItem,
  assignIdeaItemOwner,
  createIdeaItem,
  createIdeaItemComment,
  createWorkItem,
  deleteIdeaItem,
  getCommentsByIdeaItem,
  getIdeaItemById,
  getIdeaItemTraceability,
  getIdeaItems,
  getTagById,
  getTagsByIdeaItem,
  linkFeedbackToIdeaItem,
  linkWorkItemToIdeaItem,
  removeTagFromIdeaItem,
  setIdeaItemDueDate,
  setIdeaItemStatus,
  toggleIdeaItemDiscussed,
  unlinkFeedbackFromIdeaItem,
  updateIdeaItem,
} from "@almirant/database";
import { wsConnectionManager } from "../../shared/ws/ws-connection-manager";
import {
  getManagedByAgentFromExtra,
  getWorkspaceIdFromExtra,
  getProjectIdFromExtra,
  getUserIdFromExtra,
} from "../setup";

const IDEA_ITEM_TYPE_SCHEMA = z.enum(["idea"]);
// Keep this aligned with IDEA_STATUS_BY_TYPE + DB check constraints for idea_items.
const IDEA_ITEM_STATUS_SCHEMA = z.enum([
  "draft",
  "active",
  "to_review",
  "approved",
  "archived",
  "rejected",
]);
const WORK_ITEM_TYPE_SCHEMA = z.enum(["task", "story", "feature", "epic"]);
const PRIORITY_SCHEMA = z.enum(["low", "medium", "high", "urgent"]);

const mapErrorMessage = (error: unknown): string => {
  const message = error instanceof Error ? error.message : String(error);

  if (message === "OWNER_NOT_MEMBER") {
    return "Selected owner does not belong to active workspace";
  }
  if (message === "INVALID_STATUS_FOR_TYPE") {
    return "Invalid status for selected idea item type";
  }
  if (message === "INVALID_IDEA_ITEM_TYPE") {
    return "Invalid idea item type. Allowed types: idea";
  }
  if (message === "IDEA_ITEM_NOT_FOUND") {
    return "Idea item not found";
  }
  if (message === "WORK_ITEM_NOT_FOUND") {
    return "Work item not found";
  }
  if (message === "FEEDBACK_NOT_FOUND") {
    return "Feedback item not found";
  }
  if (message === "PROJECT_NOT_IN_WORKSPACE") {
    return "Selected project does not belong to active workspace";
  }

  return message;
};

const getEventContextFromExtra = (extra: { authInfo?: { clientId?: string } }) => {
  const managedBy = getManagedByAgentFromExtra(extra);
  return {
    triggeredBy: managedBy ?? "system",
    triggeredByUserId: null,
  } as const;
};

export const registerIdeasTools = (server: McpServer) => {
  server.tool(
    "list_idea_items",
    "List idea hub items with pagination and filters",
    {
      page: z.number().int().min(1).optional(),
      limit: z.number().int().min(1).max(100).optional(),
      type: IDEA_ITEM_TYPE_SCHEMA.optional(),
      status: IDEA_ITEM_STATUS_SCHEMA.optional(),
      ownerUserId: z.string().optional(),
      projectId: z.string().uuid().optional(),
      search: z.string().optional(),
      dueDate: z.string().optional(),
      discussed: z.boolean().optional(),
      tagId: z.string().uuid().optional(),
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

        const page = params.page ?? 1;
        const limit = params.limit ?? 50;
        const offset = (page - 1) * limit;
        const defaultProjectId = getProjectIdFromExtra(extra);

        const { items, total } = await getIdeaItems(
          workspaceId,
          { page, limit, offset },
          {
            type: params.type,
            status: params.status,
            ownerUserId: params.ownerUserId,
            projectId: params.projectId ?? defaultProjectId,
            search: params.search,
            dueDate: params.dueDate,
            discussed: params.discussed,
            tagIds: params.tagId,
          }
        );

        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(
                {
                  items,
                  pagination: {
                    page,
                    limit,
                    total,
                    totalPages: Math.ceil(total / limit),
                  },
                },
                null,
                2
              ),
            },
          ],
        };
      } catch (error) {
        return {
          content: [{ type: "text" as const, text: `Error listing idea items: ${mapErrorMessage(error)}` }],
          isError: true,
        };
      }
    }
  );

  server.tool(
    "get_idea_item",
    "Get an idea hub item by ID including traceability links",
    {
      id: z.string().uuid(),
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

        const item = await getIdeaItemById(workspaceId, params.id);
        if (!item) {
          return {
            content: [{ type: "text" as const, text: `Error: idea item '${params.id}' not found` }],
            isError: true,
          };
        }

        return { content: [{ type: "text" as const, text: JSON.stringify(item, null, 2) }] };
      } catch (error) {
        return {
          content: [{ type: "text" as const, text: `Error getting idea item: ${mapErrorMessage(error)}` }],
          isError: true,
        };
      }
    }
  );

  server.tool(
    "create_idea_item",
    "Create a new idea hub item",
    {
      title: z.string().min(1),
      type: IDEA_ITEM_TYPE_SCHEMA,
      status: IDEA_ITEM_STATUS_SCHEMA.optional(),
      projectId: z.string().uuid().nullable().optional(),
      description: z.string().nullable().optional(),
      ownerUserId: z.string().nullable().optional(),
      dueDate: z.string().nullable().optional(),
      metadata: z.record(z.string(), z.any()).optional(),
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

        const defaultProjectId = getProjectIdFromExtra(extra);

        const item = await createIdeaItem(
          workspaceId,
          {
            title: params.title,
            type: params.type,
            status: params.status,
            projectId: params.projectId === undefined ? defaultProjectId ?? null : params.projectId,
            description: params.description ?? null,
            ownerUserId: params.ownerUserId ?? null,
            dueDate: params.dueDate ?? null,
            metadata: params.metadata ?? {},
          },
          getEventContextFromExtra(extra)
        );

        wsConnectionManager.broadcastToWorkspace(workspaceId, {
          type: "idea-item:created",
          payload: { ideaItemId: item.id, type: item.type, title: item.title, projectId: item.projectId },
        });

        return { content: [{ type: "text" as const, text: JSON.stringify(item, null, 2) }] };
      } catch (error) {
        return {
          content: [{ type: "text" as const, text: `Error creating idea item: ${mapErrorMessage(error)}` }],
          isError: true,
        };
      }
    }
  );

  server.tool(
    "update_idea_item",
    "Update an existing idea hub item",
    {
      id: z.string().uuid(),
      title: z.string().min(1).optional(),
      type: IDEA_ITEM_TYPE_SCHEMA.optional(),
      status: IDEA_ITEM_STATUS_SCHEMA.optional(),
      projectId: z.string().uuid().nullable().optional(),
      description: z.string().nullable().optional(),
      ownerUserId: z.string().nullable().optional(),
      dueDate: z.string().nullable().optional(),
      metadata: z.record(z.string(), z.any()).optional(),
      discussed: z.boolean().optional(),
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

        const updated = await updateIdeaItem(
          workspaceId,
          params.id,
          {
            title: params.title,
            type: params.type,
            status: params.status,
            projectId: params.projectId,
            description: params.description,
            ownerUserId: params.ownerUserId,
            dueDate: params.dueDate,
            metadata: params.metadata,
            discussed: params.discussed,
          },
          getEventContextFromExtra(extra)
        );

        if (!updated) {
          return {
            content: [{ type: "text" as const, text: `Error: idea item '${params.id}' not found` }],
            isError: true,
          };
        }

        const { id: _id, ...changes } = params;
        wsConnectionManager.broadcastToWorkspace(workspaceId, {
          type: "idea-item:updated",
          payload: { ideaItemId: params.id, changes: changes as Record<string, unknown> },
        });

        return { content: [{ type: "text" as const, text: JSON.stringify(updated, null, 2) }] };
      } catch (error) {
        return {
          content: [{ type: "text" as const, text: `Error updating idea item: ${mapErrorMessage(error)}` }],
          isError: true,
        };
      }
    }
  );

  server.tool(
    "delete_idea_item",
    "Delete an idea hub item by ID",
    {
      id: z.string().uuid(),
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

        const deleted = await deleteIdeaItem(workspaceId, params.id);
        if (!deleted) {
          return {
            content: [{ type: "text" as const, text: `Error: idea item '${params.id}' not found` }],
            isError: true,
          };
        }

        wsConnectionManager.broadcastToWorkspace(workspaceId, {
          type: "idea-item:deleted",
          payload: { ideaItemId: params.id },
        });

        return { content: [{ type: "text" as const, text: JSON.stringify({ deleted: true }, null, 2) }] };
      } catch (error) {
        return {
          content: [{ type: "text" as const, text: `Error deleting idea item: ${mapErrorMessage(error)}` }],
          isError: true,
        };
      }
    }
  );

  server.tool(
    "set_idea_item_status",
    "Update status of an idea hub item",
    {
      id: z.string().uuid(),
      status: IDEA_ITEM_STATUS_SCHEMA,
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

        const updated = await setIdeaItemStatus(
          workspaceId,
          params.id,
          params.status,
          getEventContextFromExtra(extra)
        );
        if (!updated) {
          return {
            content: [{ type: "text" as const, text: `Error: idea item '${params.id}' not found` }],
            isError: true,
          };
        }

        wsConnectionManager.broadcastToWorkspace(workspaceId, {
          type: "idea-item:updated",
          payload: { ideaItemId: params.id, changes: { status: params.status } },
        });

        return { content: [{ type: "text" as const, text: JSON.stringify(updated, null, 2) }] };
      } catch (error) {
        return {
          content: [{ type: "text" as const, text: `Error updating status: ${mapErrorMessage(error)}` }],
          isError: true,
        };
      }
    }
  );

  server.tool(
    "assign_idea_item_owner",
    "Assign or clear owner for an idea hub item",
    {
      id: z.string().uuid(),
      ownerUserId: z.string().nullable(),
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

        const updated = await assignIdeaItemOwner(
          workspaceId,
          params.id,
          params.ownerUserId,
          getEventContextFromExtra(extra)
        );
        if (!updated) {
          return {
            content: [{ type: "text" as const, text: `Error: idea item '${params.id}' not found` }],
            isError: true,
          };
        }

        wsConnectionManager.broadcastToWorkspace(workspaceId, {
          type: "idea-item:updated",
          payload: { ideaItemId: params.id, changes: { ownerUserId: params.ownerUserId } },
        });

        return { content: [{ type: "text" as const, text: JSON.stringify(updated, null, 2) }] };
      } catch (error) {
        return {
          content: [{ type: "text" as const, text: `Error assigning owner: ${mapErrorMessage(error)}` }],
          isError: true,
        };
      }
    }
  );

  server.tool(
    "set_idea_item_due_date",
    "Set or clear due date for an idea hub item",
    {
      id: z.string().uuid(),
      dueDate: z.string().nullable(),
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

        const updated = await setIdeaItemDueDate(
          workspaceId,
          params.id,
          params.dueDate,
          getEventContextFromExtra(extra)
        );
        if (!updated) {
          return {
            content: [{ type: "text" as const, text: `Error: idea item '${params.id}' not found` }],
            isError: true,
          };
        }

        wsConnectionManager.broadcastToWorkspace(workspaceId, {
          type: "idea-item:updated",
          payload: { ideaItemId: params.id, changes: { dueDate: params.dueDate } },
        });

        return { content: [{ type: "text" as const, text: JSON.stringify(updated, null, 2) }] };
      } catch (error) {
        return {
          content: [{ type: "text" as const, text: `Error setting due date: ${mapErrorMessage(error)}` }],
          isError: true,
        };
      }
    }
  );

  server.tool(
    "toggle_idea_item_discussed",
    "Set or clear the discussed flag for an idea hub item",
    {
      id: z.string().uuid(),
      discussed: z.boolean(),
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

        const updated = await toggleIdeaItemDiscussed(
          workspaceId,
          params.id,
          params.discussed,
          getEventContextFromExtra(extra)
        );
        if (!updated) {
          return {
            content: [{ type: "text" as const, text: `Error: idea item '${params.id}' not found` }],
            isError: true,
          };
        }

        wsConnectionManager.broadcastToWorkspace(workspaceId, {
          type: "idea-item:updated",
          payload: { ideaItemId: params.id, changes: { discussed: params.discussed } },
        });

        return { content: [{ type: "text" as const, text: JSON.stringify(updated, null, 2) }] };
      } catch (error) {
        return {
          content: [{ type: "text" as const, text: `Error toggling discussed: ${mapErrorMessage(error)}` }],
          isError: true,
        };
      }
    }
  );

  server.tool(
    "promote_idea_item",
    "Promote an idea hub item to a work item and persist traceability link",
    {
      id: z.string().uuid().describe("Idea item id"),
      workItemType: WORK_ITEM_TYPE_SCHEMA,
      title: z.string().min(1),
      description: z.string().optional(),
      priority: PRIORITY_SCHEMA.optional(),
      boardId: z.string().uuid(),
      boardColumnId: z.string().uuid().optional(),
      projectId: z.string().uuid().optional(),
      parentId: z.string().uuid().optional(),
      notes: z.string().optional(),
      promotedBy: z.string().optional(),
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

        const source = await getIdeaItemById(workspaceId, params.id);
        if (!source) {
          return {
            content: [{ type: "text" as const, text: `Error: idea item '${params.id}' not found` }],
            isError: true,
          };
        }

        const defaultProjectId = getProjectIdFromExtra(extra);
        const projectId = params.projectId ?? source.projectId ?? defaultProjectId;
        if (!projectId) {
          return {
            content: [{ type: "text" as const, text: "Error: projectId is required to promote an idea item" }],
            isError: true,
          };
        }

        const workItem = await createWorkItem(workspaceId, {
          projectId,
          boardId: params.boardId,
          boardColumnId: params.boardColumnId ?? null,
          parentId: params.parentId,
          type: params.workItemType,
          title: params.title.trim(),
          description: params.description,
          priority: params.priority,
          metadata: {
            promotedFromIdeaItem: params.id,
          },
        });

        const link = await linkWorkItemToIdeaItem(
          workspaceId,
          params.id,
          workItem.id,
          "promoted_to",
          params.promotedBy ?? null,
          { notes: params.notes ?? null },
          params.promotedBy
            ? {
                triggeredBy: "user",
                triggeredByUserId: params.promotedBy,
              }
            : getEventContextFromExtra(extra)
        );

        wsConnectionManager.broadcastToWorkspace(workspaceId, {
          type: "work-item:created",
          payload: {
            workItemId: workItem.id,
            boardId: workItem.boardId,
            title: workItem.title,
            taskId: workItem.taskId ?? undefined,
          },
        });

        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(
                {
                  source: {
                    id: source.id,
                    type: source.type,
                    status: source.status,
                  },
                  workItem: {
                    id: workItem.id,
                    taskId: workItem.taskId,
                    title: workItem.title,
                    type: workItem.type,
                  },
                  link: {
                    id: link.id,
                    ideaItemId: link.ideaItemId,
                    workItemId: link.workItemId,
                    linkType: link.linkType,
                    createdAt: link.createdAt,
                  },
                },
                null,
                2
              ),
            },
          ],
        };
      } catch (error) {
        return {
          content: [{ type: "text" as const, text: `Error promoting idea item: ${mapErrorMessage(error)}` }],
          isError: true,
        };
      }
    }
  );

  server.tool(
    "get_idea_item_traceability",
    "Get traceability links for an idea hub item",
    {
      id: z.string().uuid(),
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

        const traceability = await getIdeaItemTraceability(workspaceId, params.id);
        if (!traceability) {
          return {
            content: [{ type: "text" as const, text: `Error: idea item '${params.id}' not found` }],
            isError: true,
          };
        }

        return { content: [{ type: "text" as const, text: JSON.stringify(traceability, null, 2) }] };
      } catch (error) {
        return {
          content: [{ type: "text" as const, text: `Error getting traceability: ${mapErrorMessage(error)}` }],
          isError: true,
        };
      }
    }
  );

  server.tool(
    "link_feedback_to_idea_item",
    "Create traceability link between an idea item and a feedback item",
    {
      ideaItemId: z.string().uuid(),
      feedbackItemId: z.string().uuid(),
      metadata: z.record(z.string(), z.any()).optional(),
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

        const link = await linkFeedbackToIdeaItem(
          workspaceId,
          params.ideaItemId,
          params.feedbackItemId,
          params.metadata ?? {},
          getEventContextFromExtra(extra)
        );

        return { content: [{ type: "text" as const, text: JSON.stringify(link, null, 2) }] };
      } catch (error) {
        return {
          content: [{ type: "text" as const, text: `Error linking feedback: ${mapErrorMessage(error)}` }],
          isError: true,
        };
      }
    }
  );

  server.tool(
    "unlink_feedback_from_idea_item",
    "Remove traceability link between an idea item and a feedback item",
    {
      ideaItemId: z.string().uuid(),
      feedbackItemId: z.string().uuid(),
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

        const deleted = await unlinkFeedbackFromIdeaItem(
          workspaceId,
          params.ideaItemId,
          params.feedbackItemId,
          getEventContextFromExtra(extra)
        );

        return { content: [{ type: "text" as const, text: JSON.stringify({ deleted }, null, 2) }] };
      } catch (error) {
        return {
          content: [{ type: "text" as const, text: `Error unlinking feedback: ${mapErrorMessage(error)}` }],
          isError: true,
        };
      }
    }
  );

  // ── Comments ──

  server.tool(
    "list_idea_comments",
    "List comments for an idea hub item",
    {
      ideaItemId: z.string().uuid(),
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

        const comments = await getCommentsByIdeaItem(workspaceId, params.ideaItemId);
        return { content: [{ type: "text" as const, text: JSON.stringify(comments, null, 2) }] };
      } catch (error) {
        return {
          content: [{ type: "text" as const, text: `Error listing comments: ${mapErrorMessage(error)}` }],
          isError: true,
        };
      }
    }
  );

  server.tool(
    "add_idea_comment",
    "Add a comment to an idea hub item",
    {
      ideaItemId: z.string().uuid(),
      content: z.string().min(1),
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

        const comment = await createIdeaItemComment(
          workspaceId,
          params.ideaItemId,
          userId,
          params.content
        );

        return { content: [{ type: "text" as const, text: JSON.stringify(comment, null, 2) }] };
      } catch (error) {
        return {
          content: [{ type: "text" as const, text: `Error adding comment: ${mapErrorMessage(error)}` }],
          isError: true,
        };
      }
    }
  );

  // ── Tags ──

  server.tool(
    "add_tag_to_idea_item",
    "Assign a tag to an idea item by tag ID",
    {
      ideaItemId: z.string().uuid().describe("Idea item ID"),
      tagId: z.string().uuid().describe("Tag ID to assign"),
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

        const item = await getIdeaItemById(workspaceId, params.ideaItemId);
        if (!item) {
          return {
            content: [{ type: "text" as const, text: `Error: idea item '${params.ideaItemId}' not found` }],
            isError: true,
          };
        }

        const tag = await getTagById(workspaceId, params.tagId);
        if (!tag) {
          return {
            content: [{ type: "text" as const, text: `Error: tag '${params.tagId}' not found` }],
            isError: true,
          };
        }

        await addTagToIdeaItem(params.ideaItemId, params.tagId);

        wsConnectionManager.broadcastToWorkspace(workspaceId, {
          type: "idea-item:updated",
          payload: { ideaItemId: params.ideaItemId, changes: { tagAdded: params.tagId } },
        });

        return {
          content: [{ type: "text" as const, text: JSON.stringify({ success: true, ideaItemId: params.ideaItemId, tagId: params.tagId }, null, 2) }],
        };
      } catch (error) {
        return {
          content: [{ type: "text" as const, text: `Error adding tag to idea item: ${mapErrorMessage(error)}` }],
          isError: true,
        };
      }
    }
  );

  server.tool(
    "remove_tag_from_idea_item",
    "Remove a tag association from an idea item",
    {
      ideaItemId: z.string().uuid().describe("Idea item ID"),
      tagId: z.string().uuid().describe("Tag ID to remove"),
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

        const item = await getIdeaItemById(workspaceId, params.ideaItemId);
        if (!item) {
          return {
            content: [{ type: "text" as const, text: `Error: idea item '${params.ideaItemId}' not found` }],
            isError: true,
          };
        }

        const deleted = await removeTagFromIdeaItem(params.ideaItemId, params.tagId);
        if (!deleted) {
          return {
            content: [{ type: "text" as const, text: `Error: tag '${params.tagId}' is not associated with idea item '${params.ideaItemId}'` }],
            isError: true,
          };
        }

        wsConnectionManager.broadcastToWorkspace(workspaceId, {
          type: "idea-item:updated",
          payload: { ideaItemId: params.ideaItemId, changes: { tagRemoved: params.tagId } },
        });

        return {
          content: [{ type: "text" as const, text: JSON.stringify({ success: true, deleted: true }, null, 2) }],
        };
      } catch (error) {
        return {
          content: [{ type: "text" as const, text: `Error removing tag from idea item: ${mapErrorMessage(error)}` }],
          isError: true,
        };
      }
    }
  );

  server.tool(
    "list_idea_item_tags",
    "List all tags associated with an idea item",
    {
      ideaItemId: z.string().uuid().describe("Idea item ID"),
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

        const item = await getIdeaItemById(workspaceId, params.ideaItemId);
        if (!item) {
          return {
            content: [{ type: "text" as const, text: `Error: idea item '${params.ideaItemId}' not found` }],
            isError: true,
          };
        }

        const ideaItemTags = await getTagsByIdeaItem(params.ideaItemId);

        return {
          content: [{ type: "text" as const, text: JSON.stringify(ideaItemTags, null, 2) }],
        };
      } catch (error) {
        return {
          content: [{ type: "text" as const, text: `Error listing idea item tags: ${mapErrorMessage(error)}` }],
          isError: true,
        };
      }
    }
  );
};

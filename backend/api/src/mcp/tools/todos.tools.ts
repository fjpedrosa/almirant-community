import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  getTodoItems,
  getTodoItemById,
  createTodoItem,
  updateTodoItem,
  deleteTodoItem,
  setTodoItemStatus,
  assignTodoItemOwner,
  setTodoItemDueDate,
  getEntityComments,
  createEntityComment,
} from "@almirant/database";
import { wsConnectionManager } from "../../shared/ws/ws-connection-manager";
import {
  getManagedByAgentFromExtra,
  getWorkspaceIdFromExtra,
  getProjectIdFromExtra,
  getUserIdFromExtra,
} from "../setup";

const TODO_ITEM_STATUS_SCHEMA = z.enum(["pending", "in_progress", "done", "blocked"]);
const PRIORITY_SCHEMA = z.enum(["low", "medium", "high", "urgent"]);

const mapErrorMessage = (error: unknown): string => {
  const message = error instanceof Error ? error.message : String(error);

  if (message === "OWNER_NOT_MEMBER") {
    return "Selected owner does not belong to active workspace";
  }
  if (message === "PROJECT_NOT_IN_WORKSPACE") {
    return "Selected project does not belong to active workspace";
  }
  if (message === "FAILED_TO_CREATE_TODO_ITEM") {
    return "Failed to create todo item";
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

export const registerTodosTools = (server: McpServer) => {
  server.tool(
    "list_todo_items",
    "List todo items with pagination and filters",
    {
      page: z.number().int().min(1).optional(),
      limit: z.number().int().min(1).max(100).optional(),
      status: TODO_ITEM_STATUS_SCHEMA.optional(),
      priority: PRIORITY_SCHEMA.optional(),
      ownerUserId: z.string().optional(),
      projectId: z.string().uuid().optional(),
      search: z.string().optional(),
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

        const { items, total } = await getTodoItems(
          workspaceId,
          { page, limit, offset },
          {
            status: params.status,
            priority: params.priority,
            ownerUserId: params.ownerUserId,
            projectId: params.projectId ?? defaultProjectId,
            search: params.search,
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
          content: [{ type: "text" as const, text: `Error listing todo items: ${mapErrorMessage(error)}` }],
          isError: true,
        };
      }
    }
  );

  server.tool(
    "get_todo_item",
    "Get a single todo item by ID including tags and other relations",
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

        const item = await getTodoItemById(workspaceId, params.id);

        if (!item) {
          return {
            content: [{ type: "text" as const, text: "Error: Todo item not found" }],
            isError: true,
          };
        }

        return {
          content: [{ type: "text" as const, text: JSON.stringify(item, null, 2) }],
        };
      } catch (error) {
        return {
          content: [{ type: "text" as const, text: `Error getting todo item: ${mapErrorMessage(error)}` }],
          isError: true,
        };
      }
    }
  );

  server.tool(
    "create_todo_item",
    "Create a new todo item",
    {
      title: z.string().min(1),
      description: z.string().optional(),
      status: TODO_ITEM_STATUS_SCHEMA.optional(),
      priority: PRIORITY_SCHEMA.optional(),
      projectId: z.string().uuid().optional(),
      ownerUserId: z.string().optional(),
      dueDate: z.string().optional(),
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

        const eventContext = getEventContextFromExtra(extra);

        const item = await createTodoItem(
          workspaceId,
          {
            title: params.title,
            description: params.description,
            status: params.status ?? "pending",
            priority: params.priority ?? "medium",
            projectId: params.projectId,
            ownerUserId: params.ownerUserId,
            dueDate: params.dueDate,
          },
          eventContext
        );

        wsConnectionManager.broadcastToWorkspace(workspaceId, {
          type: "todo-item:created" as any,
          payload: {
            todoItemId: item.id,
          },
        });

        return {
          content: [{ type: "text" as const, text: JSON.stringify(item, null, 2) }],
        };
      } catch (error) {
        return {
          content: [{ type: "text" as const, text: `Error creating todo item: ${mapErrorMessage(error)}` }],
          isError: true,
        };
      }
    }
  );

  server.tool(
    "update_todo_item",
    "Update a todo item (partial update)",
    {
      id: z.string().uuid(),
      title: z.string().min(1).optional(),
      description: z.string().optional(),
      priority: PRIORITY_SCHEMA.optional(),
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

        const eventContext = getEventContextFromExtra(extra);

        const item = await updateTodoItem(
          workspaceId,
          params.id,
          {
            title: params.title,
            description: params.description,
            priority: params.priority,
          },
          eventContext
        );

        if (!item) {
          return {
            content: [{ type: "text" as const, text: "Error: Todo item not found" }],
            isError: true,
          };
        }

        wsConnectionManager.broadcastToWorkspace(workspaceId, {
          type: "todo-item:updated" as any,
          payload: {
            todoItemId: item.id,
          },
        });

        return {
          content: [{ type: "text" as const, text: JSON.stringify(item, null, 2) }],
        };
      } catch (error) {
        return {
          content: [{ type: "text" as const, text: `Error updating todo item: ${mapErrorMessage(error)}` }],
          isError: true,
        };
      }
    }
  );

  server.tool(
    "delete_todo_item",
    "Delete a todo item",
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

        const result = await deleteTodoItem(workspaceId, params.id);

        if (!result) {
          return {
            content: [{ type: "text" as const, text: "Error: Todo item not found" }],
            isError: true,
          };
        }

        wsConnectionManager.broadcastToWorkspace(workspaceId, {
          type: "todo-item:deleted" as any,
          payload: {
            todoItemId: params.id,
          },
        });

        return {
          content: [{ type: "text" as const, text: JSON.stringify({ success: true }, null, 2) }],
        };
      } catch (error) {
        return {
          content: [{ type: "text" as const, text: `Error deleting todo item: ${mapErrorMessage(error)}` }],
          isError: true,
        };
      }
    }
  );

  server.tool(
    "set_todo_item_status",
    "Set the status of a todo item",
    {
      id: z.string().uuid(),
      status: TODO_ITEM_STATUS_SCHEMA,
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

        const eventContext = getEventContextFromExtra(extra);

        const item = await setTodoItemStatus(workspaceId, params.id, params.status, eventContext);

        if (!item) {
          return {
            content: [{ type: "text" as const, text: "Error: Todo item not found" }],
            isError: true,
          };
        }

        wsConnectionManager.broadcastToWorkspace(workspaceId, {
          type: "todo-item:updated" as any,
          payload: {
            todoItemId: item.id,
          },
        });

        return {
          content: [{ type: "text" as const, text: JSON.stringify(item, null, 2) }],
        };
      } catch (error) {
        return {
          content: [{ type: "text" as const, text: `Error setting todo item status: ${mapErrorMessage(error)}` }],
          isError: true,
        };
      }
    }
  );

  server.tool(
    "assign_todo_item_owner",
    "Assign or clear owner for a todo item",
    {
      id: z.string().uuid(),
      ownerUserId: z.string().optional(),
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

        const eventContext = getEventContextFromExtra(extra);

        const item = await assignTodoItemOwner(workspaceId, params.id, params.ownerUserId ?? null, eventContext);

        if (!item) {
          return {
            content: [{ type: "text" as const, text: "Error: Todo item not found" }],
            isError: true,
          };
        }

        wsConnectionManager.broadcastToWorkspace(workspaceId, {
          type: "todo-item:updated" as any,
          payload: {
            todoItemId: item.id,
          },
        });

        return {
          content: [{ type: "text" as const, text: JSON.stringify(item, null, 2) }],
        };
      } catch (error) {
        return {
          content: [{ type: "text" as const, text: `Error assigning todo item owner: ${mapErrorMessage(error)}` }],
          isError: true,
        };
      }
    }
  );

  server.tool(
    "set_todo_item_due_date",
    "Set or clear due date for a todo item",
    {
      id: z.string().uuid(),
      dueDate: z.string().optional(),
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

        const eventContext = getEventContextFromExtra(extra);

        const item = await setTodoItemDueDate(
          workspaceId,
          params.id,
          params.dueDate ?? null,
          eventContext
        );

        if (!item) {
          return {
            content: [{ type: "text" as const, text: "Error: Todo item not found" }],
            isError: true,
          };
        }

        wsConnectionManager.broadcastToWorkspace(workspaceId, {
          type: "todo-item:updated" as any,
          payload: {
            todoItemId: item.id,
          },
        });

        return {
          content: [{ type: "text" as const, text: JSON.stringify(item, null, 2) }],
        };
      } catch (error) {
        return {
          content: [{ type: "text" as const, text: `Error setting todo item due date: ${mapErrorMessage(error)}` }],
          isError: true,
        };
      }
    }
  );

  // ── Comments ──

  server.tool(
    "list_todo_comments",
    "List comments for a todo item",
    {
      todoItemId: z.string().uuid(),
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

        const todo = await getTodoItemById(workspaceId, params.todoItemId);
        if (!todo) {
          return {
            content: [{ type: "text" as const, text: "Error: Todo item not found" }],
            isError: true,
          };
        }

        const comments = await getEntityComments("todo", params.todoItemId);
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
    "add_todo_comment",
    "Add a comment to a todo item",
    {
      todoItemId: z.string().uuid(),
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

        const todo = await getTodoItemById(workspaceId, params.todoItemId);
        if (!todo) {
          return {
            content: [{ type: "text" as const, text: "Error: Todo item not found" }],
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

        const comment = await createEntityComment("todo", params.todoItemId, userId, params.content);

        wsConnectionManager.broadcastToWorkspace(workspaceId, {
          type: "todo-item:comment-added" as any,
          payload: {
            todoItemId: params.todoItemId,
          },
        });

        return { content: [{ type: "text" as const, text: JSON.stringify(comment, null, 2) }] };
      } catch (error) {
        return {
          content: [{ type: "text" as const, text: `Error adding comment: ${mapErrorMessage(error)}` }],
          isError: true,
        };
      }
    }
  );
};

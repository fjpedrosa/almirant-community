import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  addTagToSeed,
  bulkSelectSeedsForIdeation,
  createEntityComment,
  createSeed,
  createWorkItem,
  deleteSeed,
  getEntityComments,
  getSeedById,
  getSeeds,
  getSelectedSeedsForIdeation,
  getTagById,
  getTagsBySeed,
  linkWorkItemToSeed,
  removeTagFromSeed,
  setSeedStatus,
  updateSeed,
} from "@almirant/database";
import type { SeedWithRelations } from "@almirant/database";
import { wsConnectionManager } from "../../shared/ws/ws-connection-manager";
import {
  getManagedByAgentFromExtra,
  getOrganizationIdFromExtra,
  getProjectIdFromExtra,
  getUserIdFromExtra,
} from "../setup";

// ── Schemas ──

const SEED_STATUS_SCHEMA = z.enum([
  "draft",
  "active",
  "to_review",
  "approved",
  "archived",
  "rejected",
]);
const SEED_STATUS_GROUP_SCHEMA = z.enum(["active", "finished"]);
const SEED_SOURCE_SCHEMA = z.enum(["manual", "feedback", "ai_generated", "import"]);
const PRIORITY_SCHEMA = z.enum(["low", "medium", "high", "urgent"]);
const WORK_ITEM_TYPE_SCHEMA = z.enum(["task", "story", "feature", "epic"]);

// ── Helpers ──

const mapErrorMessage = (error: unknown): string => {
  const message = error instanceof Error ? error.message : String(error);

  if (message === "OWNER_NOT_MEMBER") return "Selected owner does not belong to active organization";
  if (message === "SEED_NOT_FOUND") return "Seed not found";
  if (message === "WORK_ITEM_NOT_FOUND") return "Work item not found";
  if (message === "FEEDBACK_NOT_FOUND") return "Feedback item not found";
  if (message === "PROJECT_NOT_IN_ORGANIZATION") return "Selected project does not belong to active organization";
  if (message === "INVALID_SEED_STATUS") return "Invalid seed status";

  return message;
};

const getEventContextFromExtra = (extra: { authInfo?: { clientId?: string } }) => {
  const managedBy = getManagedByAgentFromExtra(extra);
  return {
    triggeredBy: managedBy ?? "system",
    triggeredByUserId: null,
  } as const;
};

const formatDate = (date: Date): string => {
  const d = new Date(date);
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
};

const formatSeedsAsPlainText = (
  seeds: SeedWithRelations[],
  source: "selected" | "all_active"
): string => {
  const header =
    source === "selected"
      ? `Seeds selected for ideation (${seeds.length} seeds):`
      : `All active seeds (${seeds.length} seeds, none were explicitly selected):`;

  const entries = seeds.map((seed, index) => {
    const lines: string[] = [];
    lines.push(`${index + 1}. ${seed.title}`);
    lines.push(`   ${seed.description ?? "No description"}`);
    if (seed.projectName) {
      lines.push(`   Project: ${seed.projectName}`);
    }
    if (seed.source) {
      lines.push(`   Source: ${seed.source}`);
    }
    if (seed.priority) {
      lines.push(`   Priority: ${seed.priority}`);
    }
    if (seed.tags.length > 0) {
      lines.push(`   Tags: ${seed.tags.map((t: { name: string }) => t.name).join(", ")}`);
    }
    lines.push(`   Created: ${formatDate(seed.createdAt)}`);
    lines.push(`   ID: ${seed.id}`);
    return lines.join("\n");
  });

  return `${header}\n\n${entries.join("\n\n")}`;
};

// ── Tool Registration ──

export const registerSeedsTools = (server: McpServer) => {
  // ── CRUD ──

  server.tool(
    "list_seeds",
    "List seeds with pagination and filters",
    {
      page: z.number().int().min(1).optional(),
      limit: z.number().int().min(1).max(100).optional(),
      status: SEED_STATUS_SCHEMA.optional(),
      statuses: z.array(SEED_STATUS_SCHEMA).optional().describe("Array of statuses to filter by (e.g. [\"draft\", \"active\"])"),
      statusGroup: SEED_STATUS_GROUP_SCHEMA.optional().describe("Status group: \"active\" (draft, active, to_review) or \"finished\" (approved, archived, rejected)"),
      ownerUserId: z.string().optional(),
      projectId: z.string().uuid().optional(),
      search: z.string().optional(),
      tagId: z.string().uuid().optional(),
      selectedForIdeation: z.boolean().optional(),
    },
    async (params, extra) => {
      try {
        const organizationId = getOrganizationIdFromExtra(extra);
        if (!organizationId) {
          return {
            content: [{ type: "text" as const, text: "Error: could not resolve organizationId from API key" }],
            isError: true,
          };
        }

        const page = params.page ?? 1;
        const limit = params.limit ?? 50;
        const offset = (page - 1) * limit;
        const defaultProjectId = getProjectIdFromExtra(extra);

        const { items, total } = await getSeeds(
          organizationId,
          { page, limit, offset },
          {
            status: params.status,
            statuses: params.statuses,
            statusGroup: params.statusGroup,
            ownerUserId: params.ownerUserId,
            projectId: params.projectId ?? defaultProjectId,
            search: params.search,
            tagIds: params.tagId,
            selectedForIdeation: params.selectedForIdeation,
          }
        );

        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(
                {
                  items,
                  pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
                },
                null,
                2
              ),
            },
          ],
        };
      } catch (error) {
        return {
          content: [{ type: "text" as const, text: `Error listing seeds: ${mapErrorMessage(error)}` }],
          isError: true,
        };
      }
    }
  );

  server.tool(
    "get_seed",
    "Get a seed by ID including traceability links (feedback and work items)",
    {
      id: z.string().uuid(),
    },
    async (params, extra) => {
      try {
        const organizationId = getOrganizationIdFromExtra(extra);
        if (!organizationId) {
          return {
            content: [{ type: "text" as const, text: "Error: could not resolve organizationId from API key" }],
            isError: true,
          };
        }

        const seed = await getSeedById(organizationId, params.id);
        if (!seed) {
          return {
            content: [{ type: "text" as const, text: `Error: seed '${params.id}' not found` }],
            isError: true,
          };
        }

        return { content: [{ type: "text" as const, text: JSON.stringify(seed, null, 2) }] };
      } catch (error) {
        return {
          content: [{ type: "text" as const, text: `Error getting seed: ${mapErrorMessage(error)}` }],
          isError: true,
        };
      }
    }
  );

  server.tool(
    "create_seed",
    "Create a new seed",
    {
      title: z.string().min(1),
      description: z.string().nullable().optional(),
      projectId: z.string().uuid().nullable().optional(),
      source: SEED_SOURCE_SCHEMA.optional(),
      priority: PRIORITY_SCHEMA.nullable().optional(),
      ownerUserId: z.string().nullable().optional(),
      selectedForIdeation: z.boolean().optional(),
      metadata: z.record(z.string(), z.any()).optional(),
    },
    async (params, extra) => {
      try {
        const organizationId = getOrganizationIdFromExtra(extra);
        if (!organizationId) {
          return {
            content: [{ type: "text" as const, text: "Error: could not resolve organizationId from API key" }],
            isError: true,
          };
        }

        const defaultProjectId = getProjectIdFromExtra(extra);

        const seed = await createSeed(
          organizationId,
          {
            title: params.title,
            projectId: params.projectId === undefined ? defaultProjectId ?? undefined : params.projectId ?? undefined,
            description: params.description ?? undefined,
            source: params.source,
            priority: params.priority ?? undefined,
            ownerUserId: params.ownerUserId ?? undefined,
            selectedForIdeation: params.selectedForIdeation,
            metadata: params.metadata ?? {},
          },
          getEventContextFromExtra(extra)
        );

        wsConnectionManager.broadcastToOrganization(organizationId, {
          type: "seed:created",
          payload: { seedId: seed.id, title: seed.title, projectId: seed.projectId },
        });

        return { content: [{ type: "text" as const, text: JSON.stringify(seed, null, 2) }] };
      } catch (error) {
        return {
          content: [{ type: "text" as const, text: `Error creating seed: ${mapErrorMessage(error)}` }],
          isError: true,
        };
      }
    }
  );

  server.tool(
    "update_seed",
    "Update an existing seed",
    {
      id: z.string().uuid(),
      title: z.string().min(1).optional(),
      description: z.string().nullable().optional(),
      status: SEED_STATUS_SCHEMA.optional(),
      source: SEED_SOURCE_SCHEMA.optional(),
      priority: PRIORITY_SCHEMA.nullable().optional(),
      projectId: z.string().uuid().nullable().optional(),
      ownerUserId: z.string().nullable().optional(),
      selectedForIdeation: z.boolean().optional(),
      metadata: z.record(z.string(), z.any()).optional(),
    },
    async (params, extra) => {
      try {
        const organizationId = getOrganizationIdFromExtra(extra);
        if (!organizationId) {
          return {
            content: [{ type: "text" as const, text: "Error: could not resolve organizationId from API key" }],
            isError: true,
          };
        }

        const updated = await updateSeed(
          organizationId,
          params.id,
          {
            title: params.title,
            description: params.description ?? undefined,
            status: params.status,
            source: params.source,
            priority: params.priority,
            projectId: params.projectId,
            ownerUserId: params.ownerUserId,
            selectedForIdeation: params.selectedForIdeation,
            metadata: params.metadata,
          },
          getEventContextFromExtra(extra)
        );

        if (!updated) {
          return {
            content: [{ type: "text" as const, text: `Error: seed '${params.id}' not found` }],
            isError: true,
          };
        }

        const { id: _id, ...changes } = params;
        wsConnectionManager.broadcastToOrganization(organizationId, {
          type: "seed:updated",
          payload: { seedId: params.id, changes: changes as Record<string, unknown> },
        });

        return { content: [{ type: "text" as const, text: JSON.stringify(updated, null, 2) }] };
      } catch (error) {
        return {
          content: [{ type: "text" as const, text: `Error updating seed: ${mapErrorMessage(error)}` }],
          isError: true,
        };
      }
    }
  );

  server.tool(
    "delete_seed",
    "Delete a seed by ID",
    {
      id: z.string().uuid(),
    },
    async (params, extra) => {
      try {
        const organizationId = getOrganizationIdFromExtra(extra);
        if (!organizationId) {
          return {
            content: [{ type: "text" as const, text: "Error: could not resolve organizationId from API key" }],
            isError: true,
          };
        }

        const deleted = await deleteSeed(organizationId, params.id);
        if (!deleted) {
          return {
            content: [{ type: "text" as const, text: `Error: seed '${params.id}' not found` }],
            isError: true,
          };
        }

        wsConnectionManager.broadcastToOrganization(organizationId, {
          type: "seed:deleted",
          payload: { seedId: params.id },
        });

        return { content: [{ type: "text" as const, text: JSON.stringify({ deleted: true }, null, 2) }] };
      } catch (error) {
        return {
          content: [{ type: "text" as const, text: `Error deleting seed: ${mapErrorMessage(error)}` }],
          isError: true,
        };
      }
    }
  );

  // ── Status ──

  server.tool(
    "set_seed_status",
    "Update status of a seed (draft, active, to_review, approved, archived, rejected)",
    {
      id: z.string().uuid(),
      status: SEED_STATUS_SCHEMA,
    },
    async (params, extra) => {
      try {
        const organizationId = getOrganizationIdFromExtra(extra);
        if (!organizationId) {
          return {
            content: [{ type: "text" as const, text: "Error: could not resolve organizationId from API key" }],
            isError: true,
          };
        }

        const updated = await setSeedStatus(
          organizationId,
          params.id,
          params.status,
          getEventContextFromExtra(extra)
        );

        if (!updated) {
          return {
            content: [{ type: "text" as const, text: `Error: seed '${params.id}' not found` }],
            isError: true,
          };
        }

        wsConnectionManager.broadcastToOrganization(organizationId, {
          type: "seed:updated",
          payload: { seedId: params.id, changes: { status: params.status } },
        });

        return { content: [{ type: "text" as const, text: JSON.stringify(updated, null, 2) }] };
      } catch (error) {
        return {
          content: [{ type: "text" as const, text: `Error updating seed status: ${mapErrorMessage(error)}` }],
          isError: true,
        };
      }
    }
  );

  // ── Seeds for Ideation (migrated from ideas.tools.ts) ──

  server.tool(
    "get_seeds_for_ideation",
    "Get seeds selected for ideation formatted as plain text. Returns seeds marked as selectedForIdeation first; falls back to all active seeds if none are selected. Use this to feed /ideate sessions automatically.",
    {
      projectId: z.string().uuid().optional().describe("Filter seeds by project. Falls back to MCP session default project if not provided."),
    },
    async (params, extra) => {
      try {
        const organizationId = getOrganizationIdFromExtra(extra);
        if (!organizationId) {
          return {
            content: [{ type: "text" as const, text: "Error: could not resolve organizationId from API key" }],
            isError: true,
          };
        }

        const defaultProjectId = getProjectIdFromExtra(extra);
        const projectId = params.projectId ?? defaultProjectId;

        // Try selected seeds first
        let seeds = await getSelectedSeedsForIdeation(organizationId, projectId);
        let source: "selected" | "all_active" = "selected";

        // Fallback to all active seeds if none are selected
        if (seeds.length === 0) {
          const { items } = await getSeeds(
            organizationId,
            { page: 1, limit: 100, offset: 0 },
            { status: "active", projectId }
          );
          seeds = items;
          source = "all_active";
        }

        if (seeds.length === 0) {
          return {
            content: [{ type: "text" as const, text: "No active seeds found." }],
          };
        }

        const text = formatSeedsAsPlainText(seeds, source);
        return { content: [{ type: "text" as const, text }] };
      } catch (error) {
        return {
          content: [{ type: "text" as const, text: `Error getting seeds for ideation: ${mapErrorMessage(error)}` }],
          isError: true,
        };
      }
    }
  );

  server.tool(
    "mark_seeds_as_used",
    "Clear the selectedForIdeation flag on seeds after they have been consumed by an ideation session",
    {
      ids: z.array(z.string().uuid()).min(1).describe("Array of seed IDs to mark as used (clears selectedForIdeation)"),
    },
    async (params, extra) => {
      try {
        const organizationId = getOrganizationIdFromExtra(extra);
        if (!organizationId) {
          return {
            content: [{ type: "text" as const, text: "Error: could not resolve organizationId from API key" }],
            isError: true,
          };
        }

        const count = await bulkSelectSeedsForIdeation(organizationId, params.ids, false);
        return {
          content: [{ type: "text" as const, text: `Cleared selectedForIdeation flag on ${count} seed(s).` }],
        };
      } catch (error) {
        return {
          content: [{ type: "text" as const, text: `Error marking seeds as used: ${mapErrorMessage(error)}` }],
          isError: true,
        };
      }
    }
  );

  // ── Promote ──

  server.tool(
    "promote_seed",
    "Promote a seed to a work item and persist traceability link",
    {
      id: z.string().uuid().describe("Seed ID"),
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
        const organizationId = getOrganizationIdFromExtra(extra);
        if (!organizationId) {
          return {
            content: [{ type: "text" as const, text: "Error: could not resolve organizationId from API key" }],
            isError: true,
          };
        }

        const seed = await getSeedById(organizationId, params.id);
        if (!seed) {
          return {
            content: [{ type: "text" as const, text: `Error: seed '${params.id}' not found` }],
            isError: true,
          };
        }

        const defaultProjectId = getProjectIdFromExtra(extra);
        const projectId = params.projectId ?? seed.projectId ?? defaultProjectId;
        if (!projectId) {
          return {
            content: [{ type: "text" as const, text: "Error: projectId is required to promote a seed" }],
            isError: true,
          };
        }

        const workItem = await createWorkItem(organizationId, {
          projectId,
          boardId: params.boardId,
          boardColumnId: params.boardColumnId ?? null,
          parentId: params.parentId,
          type: params.workItemType,
          title: params.title.trim(),
          description: params.description,
          priority: params.priority,
          metadata: {
            promotedFromSeed: params.id,
          },
        });

        const eventContext = params.promotedBy
          ? { triggeredBy: "user" as const, triggeredByUserId: params.promotedBy }
          : getEventContextFromExtra(extra);

        const link = await linkWorkItemToSeed(
          organizationId,
          params.id,
          workItem.id,
          "promoted_to",
          params.promotedBy ?? null,
          eventContext
        );

        wsConnectionManager.broadcastToOrganization(organizationId, {
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
                  seed: {
                    id: seed.id,
                    status: seed.status,
                    title: seed.title,
                  },
                  workItem: {
                    id: workItem.id,
                    taskId: workItem.taskId,
                    title: workItem.title,
                    type: workItem.type,
                  },
                  link: {
                    id: link.id,
                    seedId: link.seedId,
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
          content: [{ type: "text" as const, text: `Error promoting seed: ${mapErrorMessage(error)}` }],
          isError: true,
        };
      }
    }
  );

  // ── Tags ──

  server.tool(
    "add_tag_to_seed",
    "Assign a tag to a seed by tag ID",
    {
      seedId: z.string().uuid().describe("Seed ID"),
      tagId: z.string().uuid().describe("Tag ID to assign"),
    },
    async (params, extra) => {
      try {
        const organizationId = getOrganizationIdFromExtra(extra);
        if (!organizationId) {
          return {
            content: [{ type: "text" as const, text: "Error: could not resolve organizationId from API key" }],
            isError: true,
          };
        }

        const seed = await getSeedById(organizationId, params.seedId);
        if (!seed) {
          return {
            content: [{ type: "text" as const, text: `Error: seed '${params.seedId}' not found` }],
            isError: true,
          };
        }

        const tag = await getTagById(organizationId, params.tagId);
        if (!tag) {
          return {
            content: [{ type: "text" as const, text: `Error: tag '${params.tagId}' not found` }],
            isError: true,
          };
        }

        await addTagToSeed(params.seedId, params.tagId);

        wsConnectionManager.broadcastToOrganization(organizationId, {
          type: "seed:updated",
          payload: { seedId: params.seedId, changes: { tagAdded: params.tagId } },
        });

        return {
          content: [{ type: "text" as const, text: JSON.stringify({ success: true, seedId: params.seedId, tagId: params.tagId }, null, 2) }],
        };
      } catch (error) {
        return {
          content: [{ type: "text" as const, text: `Error adding tag to seed: ${mapErrorMessage(error)}` }],
          isError: true,
        };
      }
    }
  );

  server.tool(
    "remove_tag_from_seed",
    "Remove a tag association from a seed",
    {
      seedId: z.string().uuid().describe("Seed ID"),
      tagId: z.string().uuid().describe("Tag ID to remove"),
    },
    async (params, extra) => {
      try {
        const organizationId = getOrganizationIdFromExtra(extra);
        if (!organizationId) {
          return {
            content: [{ type: "text" as const, text: "Error: could not resolve organizationId from API key" }],
            isError: true,
          };
        }

        const seed = await getSeedById(organizationId, params.seedId);
        if (!seed) {
          return {
            content: [{ type: "text" as const, text: `Error: seed '${params.seedId}' not found` }],
            isError: true,
          };
        }

        const deleted = await removeTagFromSeed(params.seedId, params.tagId);
        if (!deleted) {
          return {
            content: [{ type: "text" as const, text: `Error: tag '${params.tagId}' is not associated with seed '${params.seedId}'` }],
            isError: true,
          };
        }

        wsConnectionManager.broadcastToOrganization(organizationId, {
          type: "seed:updated",
          payload: { seedId: params.seedId, changes: { tagRemoved: params.tagId } },
        });

        return {
          content: [{ type: "text" as const, text: JSON.stringify({ success: true, deleted: true }, null, 2) }],
        };
      } catch (error) {
        return {
          content: [{ type: "text" as const, text: `Error removing tag from seed: ${mapErrorMessage(error)}` }],
          isError: true,
        };
      }
    }
  );

  server.tool(
    "list_seed_tags",
    "List all tags associated with a seed",
    {
      seedId: z.string().uuid().describe("Seed ID"),
    },
    async (params, extra) => {
      try {
        const organizationId = getOrganizationIdFromExtra(extra);
        if (!organizationId) {
          return {
            content: [{ type: "text" as const, text: "Error: could not resolve organizationId from API key" }],
            isError: true,
          };
        }

        const seed = await getSeedById(organizationId, params.seedId);
        if (!seed) {
          return {
            content: [{ type: "text" as const, text: `Error: seed '${params.seedId}' not found` }],
            isError: true,
          };
        }

        const seedTags = await getTagsBySeed(params.seedId);

        return {
          content: [{ type: "text" as const, text: JSON.stringify(seedTags, null, 2) }],
        };
      } catch (error) {
        return {
          content: [{ type: "text" as const, text: `Error listing seed tags: ${mapErrorMessage(error)}` }],
          isError: true,
        };
      }
    }
  );

  // ── Comments ──

  server.tool(
    "list_seed_comments",
    "List comments for a seed",
    {
      seedId: z.string().uuid(),
    },
    async (params, extra) => {
      try {
        const organizationId = getOrganizationIdFromExtra(extra);
        if (!organizationId) {
          return {
            content: [{ type: "text" as const, text: "Error: could not resolve organizationId from API key" }],
            isError: true,
          };
        }

        const comments = await getEntityComments("seed", params.seedId);
        return { content: [{ type: "text" as const, text: JSON.stringify(comments, null, 2) }] };
      } catch (error) {
        return {
          content: [{ type: "text" as const, text: `Error listing seed comments: ${mapErrorMessage(error)}` }],
          isError: true,
        };
      }
    }
  );

  server.tool(
    "add_seed_comment",
    "Add a comment to a seed",
    {
      seedId: z.string().uuid(),
      content: z.string().min(1),
    },
    async (params, extra) => {
      try {
        const organizationId = getOrganizationIdFromExtra(extra);
        if (!organizationId) {
          return {
            content: [{ type: "text" as const, text: "Error: could not resolve organizationId from API key" }],
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

        const comment = await createEntityComment("seed", params.seedId, userId, params.content);

        return { content: [{ type: "text" as const, text: JSON.stringify(comment, null, 2) }] };
      } catch (error) {
        return {
          content: [{ type: "text" as const, text: `Error adding seed comment: ${mapErrorMessage(error)}` }],
          isError: true,
        };
      }
    }
  );
};

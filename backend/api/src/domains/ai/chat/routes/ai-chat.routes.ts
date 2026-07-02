import { Elysia, t } from "elysia";
import { sessionContextTypes } from "../../../../shared/middleware/session-context-types.plugin";
import { SystemMessage, HumanMessage, AIMessage } from "@langchain/core/messages";
import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import {
  getProjectById,
  getWorkItems,
  getAllBoards,
  getBoardById,
  updateConnectionValidation,
  getRepositories,
  getInstallationByRepoId,
  extractGithubRepoFullName,
} from "@almirant/database";
import { logger } from "@almirant/config";
import { successResponse, errorResponse } from "../../../../shared/services/response";
import { isAiConfigured } from "../../shared/services/ai-service";
import {
  resolveModelFromProviderKey,
  isAuthError,
  getDefaultModel,
} from "../../shared/services/model-factory";
import {
  buildPlanningSystemPrompt,
  type PlanningContext,
  type WorkItemSummary,
} from "../../shared/services/planning-assistant-prompt";
import { fetchRepositoryTree } from "../../../integrations/github/services/github-service";
import {
  generateWorkItems,
  aiWorkItemsArraySchema,
} from "../../shared/services/work-item-generator";

const WORK_ITEMS_BLOCK_REGEX = /```work-items\s*([\s\S]*?)```/;

/** Priority sort order: higher priority items first. */
const PRIORITY_ORDER: Record<string, number> = {
  urgent: 0,
  high: 1,
  medium: 2,
  low: 3,
};

/** Status sort order: active states first, then backlog, then done. */
const STATUS_ORDER: Record<string, number> = {
  "in progress": 0,
  "in review": 1,
  "to do": 2,
  backlog: 3,
  done: 4,
};

/**
 * Fetch the repository tree for a project's primary repository.
 * Returns the formatted tree string or undefined if unavailable.
 * Errors are caught and logged — this is a non-critical enhancement.
 */
const fetchProjectRepositoryTree = async (
  workspaceId: string,
  projectId: string
): Promise<string | undefined> => {
  try {
    const repos = await getRepositories(workspaceId, projectId);
    // Use the first repository (order=0, primary)
    const primaryRepo = repos[0];
    if (!primaryRepo || primaryRepo.provider !== "github") return undefined;

    const fullName = extractGithubRepoFullName(primaryRepo.url);
    if (!fullName) return undefined;

    const installation = await getInstallationByRepoId(primaryRepo.id);
    if (!installation || !installation.installationId) return undefined;

    const [owner, repo] = fullName.split("/");
    if (!owner || !repo) return undefined;

    const tree = await fetchRepositoryTree(
      installation.installationId,
      owner,
      repo
    );

    return tree ?? undefined;
  } catch (error) {
    logger.warn(
      { projectId, error: error instanceof Error ? error.message : String(error) },
      "Failed to fetch repository tree for planning context (non-fatal)"
    );
    return undefined;
  }
};

/**
 * Build project context for the planning assistant system prompt.
 */
const buildProjectContext = async (
  orgId: string,
  projectId: string,
  boardId?: string
): Promise<PlanningContext | null> => {
  const [project, allBoards, repositoryTree] = await Promise.all([
    getProjectById(orgId, projectId),
    getAllBoards(orgId),
    fetchProjectRepositoryTree(orgId, projectId),
  ]);
  if (!project) return null;

  const boardNames = allBoards.map((b) => b.name);

  // Get existing epics/features for context
  const { items: epics } = await getWorkItems(
    orgId,
    { page: 1, limit: 50, offset: 0 },
    { projectId, type: "epic" }
  );

  const epicTitles = epics.map((wi) => wi.title);

  // If a boardId is provided, fetch work items from the active board
  let activeBoardName: string | undefined;
  let activeWorkItems: WorkItemSummary[] | undefined;

  if (boardId) {
    const [board, { items: boardWorkItems }] = await Promise.all([
      getBoardById(boardId, orgId),
      getWorkItems(
        orgId,
        { page: 1, limit: 30, offset: 0 },
        { boardId }
      ),
    ]);

    activeBoardName = board?.name;

    // Sort by priority then by column status relevance
    const sorted = boardWorkItems.sort((a, b) => {
      const statusA = STATUS_ORDER[(a.columnName ?? "").toLowerCase()] ?? 3;
      const statusB = STATUS_ORDER[(b.columnName ?? "").toLowerCase()] ?? 3;
      if (statusA !== statusB) return statusA - statusB;
      const prioA = PRIORITY_ORDER[a.priority] ?? 2;
      const prioB = PRIORITY_ORDER[b.priority] ?? 2;
      return prioA - prioB;
    });

    activeWorkItems = sorted.map((wi) => ({
      taskId: wi.taskId,
      title: wi.title,
      type: wi.type,
      status: wi.columnName ?? "unknown",
      priority: wi.priority,
    }));
  }

  return {
    projectName: project.name,
    boardNames,
    existingEpics: epicTitles,
    activeBoardName,
    activeWorkItems,
    repositoryTree,
    locale: "es", // default; overridden by caller with user locale
  };
};

export const aiChatRoutes = new Elysia({ prefix: "/ai/chat" })
  .use(sessionContextTypes)

  // POST /ai/chat — SSE streaming chat with AI planning assistant
  .post("/", async ({ body, set, activeWorkspace, user }) => {
    const orgId = activeWorkspace!.id;
    const locale = user?.locale ?? "es";
    const { messages, projectId, boardId, providerKeyId, modelName } = body;

    // Resolve the chat model: user-provided key takes priority, then env fallback
    let model: BaseChatModel;
    let connectionId: string | undefined;
    if (providerKeyId) {
      try {
        const resolved = await resolveModelFromProviderKey(providerKeyId, {
          modelName,
          streaming: true,
        });
        model = resolved.model;
        connectionId = resolved.connectionId;
      } catch (err) {
        logger.error({ error: err, keyId: providerKeyId }, "Failed to resolve provider key");
        set.status = 400;
        return errorResponse(
          err instanceof Error ? err.message : "Failed to resolve provider API key"
        );
      }
    } else {
      if (!isAiConfigured()) {
        set.status = 503;
        return errorResponse(
          "AI service is not configured. Set OPENAI_API_KEY or provide a providerKeyId.",
          503
        );
      }
      model = getDefaultModel(true);
    }

    // Build project context for system prompt
    const context = await buildProjectContext(orgId, projectId, boardId);
    if (!context) {
      set.status = 404;
      return errorResponse("Project not found");
    }

    context.locale = locale;
    const systemPrompt = buildPlanningSystemPrompt(context);

    // Build LangChain message array
    const langchainMessages = [
      new SystemMessage(systemPrompt),
      ...messages.map((msg) =>
        msg.role === "user"
          ? new HumanMessage(msg.content)
          : new AIMessage(msg.content)
      ),
    ];

    // Create SSE readable stream
    const stream = new ReadableStream({
      async start(controller) {
        const encoder = new TextEncoder();
        let fullContent = "";

        const sendEvent = (event: string, data: Record<string, unknown>) => {
          controller.enqueue(
            encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
          );
        };

        try {
          const streamResponse = await model.stream(langchainMessages);

          for await (const chunk of streamResponse) {
            const content =
              typeof chunk.content === "string"
                ? chunk.content
                : String(chunk.content);

            if (content) {
              fullContent += content;
              sendEvent("message", { content });
            }
          }

          // After streaming completes, check if the response contains work items JSON
          const match = fullContent.match(WORK_ITEMS_BLOCK_REGEX);
          if (match?.[1]) {
            try {
              const parsed = JSON.parse(match[1].trim());
              const validated = aiWorkItemsArraySchema.parse(parsed);
              sendEvent("generation", { items: validated });
            } catch (parseErr) {
              logger.warn(
                { error: parseErr },
                "AI output contained work-items block but failed to parse"
              );
            }
          }

          // Fire-and-forget: mark connection as valid after successful streaming
          if (connectionId) {
            void updateConnectionValidation(connectionId, "valid").catch(
              (validErr: unknown) => {
                logger.warn(
                  { connectionId, error: validErr },
                  "Failed to update validation status on streaming success",
                );
              },
            );
          }

          sendEvent("done", {});
        } catch (err) {
          // Detect auth errors and suspend the connection
          if (connectionId && isAuthError(err)) {
            logger.warn(
              { connectionId, error: err },
              "Auth error detected from AI provider during streaming, suspending connection",
            );
            void updateConnectionValidation(
              connectionId,
              "invalid",
              err instanceof Error ? err.message : "Authentication failed",
            ).catch((suspendErr: unknown) => {
              logger.warn(
                { connectionId, error: suspendErr },
                "Failed to suspend connection after streaming auth error",
              );
            });
          }
          const message = err instanceof Error ? err.message : "Unknown streaming error";
          logger.error({ error: err }, "AI chat streaming error");
          sendEvent("error", { message });
        } finally {
          controller.close();
        }
      },
    });

    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      },
    });
  }, {
    body: t.Object({
      messages: t.Array(
        t.Object({
          role: t.Union([t.Literal("user"), t.Literal("assistant")]),
          content: t.String(),
        })
      ),
      projectId: t.String(),
      boardId: t.Optional(t.String()),
      providerKeyId: t.Optional(t.String()),
      modelName: t.Optional(t.String()),
    }),
  })

  // POST /ai/chat/generate — Generate work items from AI output
  .post("/generate", async ({ body, set, activeWorkspace }) => {
    try {
      // Ensure priority defaults to "medium" for items without it
      const itemsWithDefaults = body.items.map((item) => ({
        ...item,
        priority: item.priority ?? ("medium" as const),
      }));

      const result = await generateWorkItems({
        workspaceId: activeWorkspace!.id,
        items: itemsWithDefaults,
        projectId: body.projectId,
        boardId: body.boardId,
        boardColumnId: body.boardColumnId,
      });

      if (result.errors.length > 0 && result.createdIds.length === 0) {
        set.status = 400;
        return errorResponse(
          `All items failed to create. First error: ${result.errors[0]?.error}`
        );
      }

      set.status = 201;
      return successResponse(result);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      logger.error({ error: err }, "Work item generation error");
      set.status = 400;
      return errorResponse(message);
    }
  }, {
    body: t.Object({
      items: t.Array(
        t.Object({
          tempId: t.String(),
          type: t.Union([
            t.Literal("epic"),
            t.Literal("feature"),
            t.Literal("story"),
            t.Literal("task"),
          ]),
          title: t.String(),
          description: t.Optional(t.String()),
          priority: t.Optional(
            t.Union([
              t.Literal("low"),
              t.Literal("medium"),
              t.Literal("high"),
              t.Literal("urgent"),
            ])
          ),
          parentTempId: t.Optional(t.String()),
        })
      ),
      projectId: t.String(),
      boardId: t.String(),
      boardColumnId: t.String(),
    }),
  });

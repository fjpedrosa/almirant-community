import { Elysia, t } from "elysia";
import { sessionContextTypes } from "../../../../shared/middleware/session-context-types.plugin";
import {
  getAiConversations,
  getAiConversationById,
  createAiConversation,
  updateAiConversation,
  deleteAiConversation,
} from "@almirant/database";
import {
  successResponse,
  errorResponse,
  notFoundResponse,
  parsePaginationParams,
  buildPaginationMeta,
} from "../../../../shared/services/response";

export const aiConversationsRoutes = new Elysia({ prefix: "/ai/conversations" })
  .use(sessionContextTypes)

  // GET /ai/conversations — List conversations by projectId
  .get("/", async ({ query, set, activeOrganization }) => {
    if (!query.projectId) {
      set.status = 400;
      return errorResponse("projectId is required");
    }

    const orgId = activeOrganization!.id;
    const pagination = parsePaginationParams(query);
    const { conversations, total } = await getAiConversations(
      orgId,
      query.projectId,
      pagination
    );
    const meta = buildPaginationMeta(pagination.page, pagination.limit, total);

    return successResponse(conversations, meta);
  }, {
    query: t.Object({
      projectId: t.String(),
      page: t.Optional(t.String()),
      limit: t.Optional(t.String()),
    }),
  })

  // GET /ai/conversations/:id — Get single conversation
  .get("/:id", async ({ params, set, activeOrganization }) => {
    const orgId = activeOrganization!.id;
    const conversation = await getAiConversationById(orgId, params.id);
    if (!conversation) {
      set.status = 404;
      return notFoundResponse("Conversation");
    }
    return successResponse(conversation);
  }, {
    params: t.Object({ id: t.String() }),
  })

  // POST /ai/conversations — Create new conversation
  .post("/", async ({ body, set }) => {
    const conversation = await createAiConversation({
      projectId: body.projectId,
      boardId: body.boardId ?? null,
      title: body.title,
      messages: body.messages ?? [],
      status: "active",
    });

    set.status = 201;
    return successResponse(conversation);
  }, {
    body: t.Object({
      projectId: t.String(),
      boardId: t.Optional(t.String()),
      title: t.String({ minLength: 1 }),
      messages: t.Optional(
        t.Array(
          t.Object({
            role: t.Union([t.Literal("user"), t.Literal("assistant")]),
            content: t.String(),
            timestamp: t.String(),
          })
        )
      ),
    }),
  })

  // PATCH /ai/conversations/:id — Update conversation
  .patch("/:id", async ({ params, body, set, activeOrganization }) => {
    const orgId = activeOrganization!.id;
    const existing = await getAiConversationById(orgId, params.id);
    if (!existing) {
      set.status = 404;
      return notFoundResponse("Conversation");
    }

    const updated = await updateAiConversation(orgId, params.id, {
      ...(body.title !== undefined && { title: body.title }),
      ...(body.status !== undefined && { status: body.status }),
      ...(body.messages !== undefined && { messages: body.messages }),
      ...(body.generatedWorkItemIds !== undefined && {
        generatedWorkItemIds: body.generatedWorkItemIds,
      }),
      ...(body.boardId !== undefined && { boardId: body.boardId }),
    });

    return successResponse(updated);
  }, {
    params: t.Object({ id: t.String() }),
    body: t.Object({
      title: t.Optional(t.String({ minLength: 1 })),
      status: t.Optional(
        t.Union([t.Literal("active"), t.Literal("completed"), t.Literal("archived")])
      ),
      messages: t.Optional(
        t.Array(
          t.Object({
            role: t.Union([t.Literal("user"), t.Literal("assistant")]),
            content: t.String(),
            timestamp: t.String(),
          })
        )
      ),
      generatedWorkItemIds: t.Optional(t.Array(t.String())),
      boardId: t.Optional(t.Nullable(t.String())),
    }),
  })

  // DELETE /ai/conversations/:id — Delete conversation
  .delete("/:id", async ({ params, set, activeOrganization }) => {
    const orgId = activeOrganization!.id;
    const deleted = await deleteAiConversation(orgId, params.id);
    if (!deleted) {
      set.status = 404;
      return notFoundResponse("Conversation");
    }
    return successResponse({ deleted: true });
  }, {
    params: t.Object({ id: t.String() }),
  });

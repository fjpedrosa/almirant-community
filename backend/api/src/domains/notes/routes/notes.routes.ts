import { Elysia, t } from "elysia";
import { MAX_NOTE_POSITION, type LexicalDocument } from "@almirant/database";
import { sessionContextTypes } from "../../../shared/middleware/session-context-types.plugin";
import {
  errorResponse,
  internalErrorResponse,
  successResponse,
} from "../../../shared/services/response";
import {
  notesService,
  NotesServiceError,
  type NotesActor,
  type NotesService,
} from "../services/notes.service";

type RouteSet = { status?: number | string };

const actorFromContext = (
  user: { id: string } | null,
  activeWorkspace: { id: string } | null,
): NotesActor => ({
  workspaceId: activeWorkspace!.id,
  userId: user!.id,
});

const routeError = (
  error: unknown,
  set: RouteSet,
  route: string,
) => {
  if (error instanceof NotesServiceError && error.status < 500) {
    set.status = error.status;
    return errorResponse(error.message, error.status, error.code);
  }
  set.status = 500;
  const cause = error instanceof NotesServiceError ? error.cause ?? error : error;
  return internalErrorResponse(cause, { domain: "notes", route }, "Notes operation failed");
};

const visibilitySchema = t.Union([t.Literal("private"), t.Literal("workspace")]);
const lexicalSchema = t.Record(t.String(), t.Unknown());
const expectedVersionSchema = t.Integer({ minimum: 1 });
const uuidSchema = t.String({ format: "uuid" });
const pageIdParams = t.Object({ pageId: uuidSchema });
const paginationQueryFields = {
  limit: t.Optional(t.Numeric({ minimum: 1, maximum: 100 })),
  offset: t.Optional(t.Numeric({ minimum: 0, maximum: 100_000 })),
};
const paginationQuerySchema = t.Object(paginationQueryFields);

const pageCreateBody = t.Object({
  title: t.Optional(t.String({ maxLength: 500 })),
  parentId: t.Optional(t.Nullable(uuidSchema)),
  visibility: t.Optional(visibilitySchema),
  position: t.Optional(t.Integer({ minimum: 0, maximum: MAX_NOTE_POSITION })),
  lexicalJson: t.Optional(lexicalSchema),
}, { additionalProperties: false });

const pageUpdateBody = t.Object({
  expectedVersion: expectedVersionSchema,
  title: t.Optional(t.String({ maxLength: 500 })),
  parentId: t.Optional(t.Nullable(uuidSchema)),
  visibility: t.Optional(visibilitySchema),
  position: t.Optional(t.Integer({ minimum: 0, maximum: MAX_NOTE_POSITION })),
  lexicalJson: t.Optional(lexicalSchema),
}, { additionalProperties: false });

export const createNotesRoutes = (service: NotesService = notesService) =>
  new Elysia({ prefix: "/notes" })
    .use(sessionContextTypes)
    .get("/pages", async ({ query, user, activeWorkspace, set }) => {
      try {
        return successResponse(await service.listPages(actorFromContext(user, activeWorkspace), query));
      } catch (error) {
        return routeError(error, set, "GET /notes/pages");
      }
    }, { query: paginationQuerySchema })
    .get("/pages/archived", async ({ query, user, activeWorkspace, set }) => {
      try {
        return successResponse(await service.listArchivedPages(
          actorFromContext(user, activeWorkspace),
          query,
        ));
      } catch (error) {
        return routeError(error, set, "GET /notes/pages/archived");
      }
    }, { query: paginationQuerySchema })
    .get("/pages/:pageId", async ({ params, user, activeWorkspace, set }) => {
      try {
        return successResponse(
          await service.getPage(actorFromContext(user, activeWorkspace), params.pageId),
        );
      } catch (error) {
        return routeError(error, set, "GET /notes/pages/:pageId");
      }
    }, { params: pageIdParams })
    .post("/pages", async ({ body, user, activeWorkspace, set }) => {
      try {
        const created = await service.createPage(actorFromContext(user, activeWorkspace), {
          ...body,
          lexicalJson: body.lexicalJson as LexicalDocument | undefined,
        });
        set.status = 201;
        return successResponse(created, undefined, 201);
      } catch (error) {
        return routeError(error, set, "POST /notes/pages");
      }
    }, { body: pageCreateBody })
    .patch("/pages/:pageId", async ({ params, body, user, activeWorkspace, set }) => {
      try {
        return successResponse(await service.updatePage(
          actorFromContext(user, activeWorkspace),
          params.pageId,
          {
            ...body,
            lexicalJson: body.lexicalJson as LexicalDocument | undefined,
          },
        ));
      } catch (error) {
        return routeError(error, set, "PATCH /notes/pages/:pageId");
      }
    }, { params: pageIdParams, body: pageUpdateBody })
    .patch("/pages/:pageId/parent", async ({ params, body, user, activeWorkspace, set }) => {
      try {
        return successResponse(await service.reparentPage(
          actorFromContext(user, activeWorkspace),
          params.pageId,
          body,
        ));
      } catch (error) {
        return routeError(error, set, "PATCH /notes/pages/:pageId/parent");
      }
    }, {
      params: pageIdParams,
      body: t.Object({
        parentId: t.Nullable(uuidSchema),
        expectedVersion: expectedVersionSchema,
      }),
    })
    .post("/pages/:pageId/archive", async ({ params, body, user, activeWorkspace, set }) => {
      try {
        return successResponse(await service.archivePage(
          actorFromContext(user, activeWorkspace),
          params.pageId,
          body,
        ));
      } catch (error) {
        return routeError(error, set, "POST /notes/pages/:pageId/archive");
      }
    }, {
      params: pageIdParams,
      body: t.Object({ expectedVersion: expectedVersionSchema }),
    })
    .post("/pages/:pageId/restore", async ({ params, body, user, activeWorkspace, set }) => {
      try {
        return successResponse(await service.restorePage(
          actorFromContext(user, activeWorkspace),
          params.pageId,
          body,
        ));
      } catch (error) {
        return routeError(error, set, "POST /notes/pages/:pageId/restore");
      }
    }, {
      params: pageIdParams,
      body: t.Object({ expectedVersion: expectedVersionSchema }),
    })
    .get("/search", async ({ query, user, activeWorkspace, set }) => {
      try {
        return successResponse(await service.searchPages(
          actorFromContext(user, activeWorkspace),
          { query: query.q, limit: query.limit, offset: query.offset },
        ));
      } catch (error) {
        return routeError(error, set, "GET /notes/search");
      }
    }, {
      query: t.Object({
        q: t.String({ minLength: 1, maxLength: 200 }),
        ...paginationQueryFields,
      }),
    })
    .patch("/pages/:pageId/checklist/:itemId", async ({ params, body, user, activeWorkspace, set }) => {
      try {
        return successResponse(await service.updateChecklistItem(
          actorFromContext(user, activeWorkspace),
          params.pageId,
          params.itemId,
          body,
        ));
      } catch (error) {
        return routeError(error, set, "PATCH /notes/pages/:pageId/checklist/:itemId");
      }
    }, {
      params: t.Object({
        pageId: uuidSchema,
        itemId: uuidSchema,
      }),
      body: t.Object({ checked: t.Boolean(), expectedVersion: expectedVersionSchema }),
    })
    .get("/pages/:pageId/checklist-items", async ({ params, query, user, activeWorkspace, set }) => {
      try {
        return successResponse(await service.listChecklistItems(
          actorFromContext(user, activeWorkspace),
          params.pageId,
          query,
        ));
      } catch (error) {
        return routeError(error, set, "GET /notes/pages/:pageId/checklist-items");
      }
    }, { params: pageIdParams, query: paginationQuerySchema })
    .get("/pages/:pageId/links", async ({ params, query, user, activeWorkspace, set }) => {
      try {
        return successResponse(await service.listLinks(
          actorFromContext(user, activeWorkspace),
          params.pageId,
          query,
        ));
      } catch (error) {
        return routeError(error, set, "GET /notes/pages/:pageId/links");
      }
    }, { params: pageIdParams, query: paginationQuerySchema })
    .get("/pages/:pageId/backlinks", async ({ params, query, user, activeWorkspace, set }) => {
      try {
        return successResponse(await service.listBacklinks(
          actorFromContext(user, activeWorkspace),
          params.pageId,
          query,
        ));
      } catch (error) {
        return routeError(error, set, "GET /notes/pages/:pageId/backlinks");
      }
    }, { params: pageIdParams, query: paginationQuerySchema })
    .get("/pages/:pageId/shares", async ({ params, query, user, activeWorkspace, set }) => {
      try {
        return successResponse(await service.listShares(
          actorFromContext(user, activeWorkspace),
          params.pageId,
          query,
        ));
      } catch (error) {
        return routeError(error, set, "GET /notes/pages/:pageId/shares");
      }
    }, { params: pageIdParams, query: paginationQuerySchema })
    .put("/pages/:pageId/shares/:userId", async ({ params, body, user, activeWorkspace, set }) => {
      try {
        return successResponse(await service.upsertShare(
          actorFromContext(user, activeWorkspace),
          params.pageId,
          params.userId,
          body.role,
        ));
      } catch (error) {
        return routeError(error, set, "PUT /notes/pages/:pageId/shares/:userId");
      }
    }, {
      params: t.Object({
        pageId: uuidSchema,
        userId: t.String({ minLength: 1, maxLength: 255 }),
      }),
      body: t.Object({ role: t.Union([t.Literal("viewer"), t.Literal("editor")]) }),
    })
    .delete("/pages/:pageId/shares/:userId", async ({ params, user, activeWorkspace, set }) => {
      try {
        return successResponse(await service.removeShare(
          actorFromContext(user, activeWorkspace),
          params.pageId,
          params.userId,
        ));
      } catch (error) {
        return routeError(error, set, "DELETE /notes/pages/:pageId/shares/:userId");
      }
    }, {
      params: t.Object({
        pageId: uuidSchema,
        userId: t.String({ minLength: 1, maxLength: 255 }),
      }),
    })
    .get("/agenda", async ({ query, user, activeWorkspace, set }) => {
      try {
        return successResponse(await service.listAgendaMonth(
          actorFromContext(user, activeWorkspace),
          query.month,
          { limit: query.limit, offset: query.offset },
        ));
      } catch (error) {
        return routeError(error, set, "GET /notes/agenda");
      }
    }, { query: t.Object({ month: t.String({ minLength: 7, maxLength: 7 }), ...paginationQueryFields }) })
    .put("/agenda/:date", async ({ params, user, activeWorkspace, set }) => {
      try {
        return successResponse(await service.getOrCreateAgendaDay(
          actorFromContext(user, activeWorkspace),
          params.date,
        ));
      } catch (error) {
        return routeError(error, set, "PUT /notes/agenda/:date");
      }
    }, { params: t.Object({ date: t.String({ minLength: 1, maxLength: 20 }) }) })
    .get("/agenda/:date/carryover", async ({ params, query, user, activeWorkspace, set }) => {
      try {
        return successResponse(await service.listAgendaCarryover(
          actorFromContext(user, activeWorkspace),
          params.date,
          query,
        ));
      } catch (error) {
        return routeError(error, set, "GET /notes/agenda/:date/carryover");
      }
    }, { params: t.Object({ date: t.String({ minLength: 1, maxLength: 20 }) }), query: paginationQuerySchema })
    .get("/legacy", async ({ query, user, activeWorkspace, set }) => {
      try {
        return successResponse(await service.listLegacyArchive(
          actorFromContext(user, activeWorkspace),
          {
            disposition: query.disposition ?? "all",
            limit: query.limit,
            offset: query.offset,
          },
        ));
      } catch (error) {
        return routeError(error, set, "GET /notes/legacy");
      }
    }, {
      query: t.Object({
        disposition: t.Optional(t.Union([
          t.Literal("pending"),
          t.Literal("converted"),
          t.Literal("discarded"),
          t.Literal("terminal"),
          t.Literal("all"),
        ])),
        ...paginationQueryFields,
      }),
    })
    .post("/legacy/:archiveId/convert", async ({ params, body, user, activeWorkspace, set }) => {
      try {
        return successResponse(await service.convertLegacyArchive(
          actorFromContext(user, activeWorkspace),
          params.archiveId,
          body,
        ));
      } catch (error) {
        return routeError(error, set, "POST /notes/legacy/:archiveId/convert");
      }
    }, {
      params: t.Object({ archiveId: uuidSchema }),
      body: t.Object({
        pageId: t.Optional(uuidSchema),
        actionId: t.String({ minLength: 1, maxLength: 255 }),
      }),
    })
    .post("/legacy/:archiveId/discard", async ({ params, body, user, activeWorkspace, set }) => {
      try {
        return successResponse(await service.discardLegacyArchive(
          actorFromContext(user, activeWorkspace),
          params.archiveId,
          body,
        ));
      } catch (error) {
        return routeError(error, set, "POST /notes/legacy/:archiveId/discard");
      }
    }, {
      params: t.Object({ archiveId: uuidSchema }),
      body: t.Object({ actionId: t.String({ minLength: 1, maxLength: 255 }) }),
    });

export const notesRoutes = createNotesRoutes();

import { Elysia, t } from "elysia";
import path from "node:path";
import { sessionContextTypes } from "../../../shared/middleware/session-context-types.plugin";
import {
  approveHandbookCaptureProposal,
  archiveHandbookEntry,
  createHandbookCaptureProposal,
  createHandbookEntry,
  getHandbookEntryById,
  getHandbookEntryChunks,
  listHandbookCaptureProposals,
  listHandbookCategories,
  listHandbookEntries,
  rejectHandbookCaptureProposal,
  searchHandbookChunks,
  searchHandbookChunksByEmbedding,
  updateHandbookEntry,
  upsertImportedHandbookEntry,
} from "@almirant/database";
import {
  buildPaginationMeta,
  errorResponse,
  notFoundResponse,
  parsePaginationParams,
  successResponse,
} from "../../../shared/services/response";
import {
  chunkMarkdownContent,
  loadHandbookImportCandidates,
  slugifyHandbookTitle,
} from "../services/handbook-importer";
import {
  attachEmbeddingsToHandbookChunks,
  generateHandbookEmbeddingsIfConfigured,
} from "../services/handbook-embeddings";

const DEFAULT_BUILDER_HANDBOOK_DOCS_PATH =
  process.env.BUILDER_HANDBOOK_DOCS_PATH ?? path.resolve(process.cwd(), "docs", "builder-handbook");

const statusSchema = t.Union([
  t.Literal("draft"),
  t.Literal("verified"),
  t.Literal("deprecated"),
]);

const proposalStatusSchema = t.Union([
  t.Literal("pending"),
  t.Literal("approved"),
  t.Literal("rejected"),
]);

const entryBodySchema = t.Object({
  title: t.String(),
  slug: t.Optional(t.String()),
  summary: t.Optional(t.Nullable(t.String())),
  content: t.String(),
  category: t.Optional(t.String()),
  status: t.Optional(statusSchema),
  sourceProjectId: t.Optional(t.Nullable(t.String())),
  sourcePath: t.Optional(t.Nullable(t.String())),
  metadata: t.Optional(t.Record(t.String(), t.Unknown())),
  changeSummary: t.Optional(t.Nullable(t.String())),
});

const currentUserId = (ctx: unknown): string | null => {
  const user = (ctx as Record<string, unknown>).user as { id?: string } | null | undefined;
  return user?.id ?? null;
};

const normalizeRootPath = (rootPath?: string): string =>
  path.resolve(rootPath?.trim() || DEFAULT_BUILDER_HANDBOOK_DOCS_PATH);

export const handbookRoutes = new Elysia({ prefix: "/handbook" })
  .use(sessionContextTypes)

  .get(
    "/",
    async ({ query, activeWorkspace }) => {
      const orgId = activeWorkspace!.id;
      const pagination = parsePaginationParams(query);
      const { items, total } = await listHandbookEntries(orgId, pagination, {
        search: query.search || undefined,
        category: query.category || undefined,
        status: query.status as "draft" | "verified" | "deprecated" | undefined,
      });

      return successResponse(items, buildPaginationMeta(pagination.page, pagination.limit, total));
    },
    {
      query: t.Object({
        page: t.Optional(t.String()),
        limit: t.Optional(t.String()),
        search: t.Optional(t.String()),
        category: t.Optional(t.String()),
        status: t.Optional(statusSchema),
      }),
    },
  )

  .get("/categories", async ({ activeWorkspace }) => {
    const categories = await listHandbookCategories(activeWorkspace!.id);
    return successResponse(categories);
  })

  .get(
    "/search",
    async ({ query, set, activeWorkspace }) => {
      const q = query.q?.trim();
      if (!q) {
        set.status = 400;
        return errorResponse("Search query (q) is required");
      }

      const searchOptions = {
        limit: query.limit ? Number.parseInt(query.limit, 10) : undefined,
        status: query.status as "draft" | "verified" | "deprecated" | undefined,
        category: query.category || undefined,
      };
      const queryEmbedding = await generateHandbookEmbeddingsIfConfigured([q]);
      const results = queryEmbedding?.[0]
        ? await searchHandbookChunksByEmbedding(activeWorkspace!.id, queryEmbedding[0], searchOptions)
        : await searchHandbookChunks(activeWorkspace!.id, q, searchOptions);

      return successResponse(results);
    },
    {
      query: t.Object({
        q: t.String(),
        limit: t.Optional(t.String()),
        category: t.Optional(t.String()),
        status: t.Optional(statusSchema),
      }),
    },
  )

  .post(
    "/import",
    async ({ body, set, activeWorkspace }) => {
      const orgId = activeWorkspace!.id;
      const rootPath = normalizeRootPath(body.rootPath);
      const candidates = await loadHandbookImportCandidates(rootPath);

      let created = 0;
      let updated = 0;
      let skipped = 0;
      const entries: unknown[] = [];

      for (const candidate of candidates) {
        const chunks = await attachEmbeddingsToHandbookChunks(chunkMarkdownContent(candidate.content));
        const result = await upsertImportedHandbookEntry(orgId, {
          title: candidate.title,
          slug: candidate.slug,
          summary: candidate.summary,
          content: candidate.content,
          category: candidate.category,
          sourcePath: candidate.sourcePath,
          status: "verified",
          sourceType: "import",
          metadata: {
            importedFrom: rootPath,
            originalContentHash: candidate.contentHash,
          },
        }, chunks);

        if (result.action === "created") created++;
        if (result.action === "updated") updated++;
        if (result.action === "skipped") skipped++;
        entries.push(result.entry);
      }

      set.status = 201;
      return successResponse({ total: candidates.length, created, updated, skipped, entries });
    },
    {
      body: t.Object({
        rootPath: t.Optional(t.String()),
      }),
    },
  )

  .post(
    "/",
    async (ctx) => {
      const { body, set, activeWorkspace } = ctx;
      if (!body.title.trim() || !body.content.trim()) {
        set.status = 400;
        return errorResponse("Title and content are required");
      }

      const slug = body.slug?.trim() || slugifyHandbookTitle(body.title);
      const chunks = await attachEmbeddingsToHandbookChunks(chunkMarkdownContent(body.content));
      const created = await createHandbookEntry(activeWorkspace!.id, {
        title: body.title.trim(),
        slug,
        summary: body.summary ?? null,
        content: body.content,
        category: body.category?.trim() || "general",
        status: body.status ?? "draft",
        sourceType: "manual",
        sourcePath: body.sourcePath ?? null,
        sourceProjectId: body.sourceProjectId ?? null,
        metadata: body.metadata,
        createdByUserId: currentUserId(ctx),
      }, chunks);

      set.status = 201;
      return successResponse(created);
    },
    { body: entryBodySchema },
  )

  .get(
    "/proposals",
    async ({ query, activeWorkspace }) => {
      const proposals = await listHandbookCaptureProposals(
        activeWorkspace!.id,
        query.status as "pending" | "approved" | "rejected" | undefined,
      );
      return successResponse(proposals);
    },
    {
      query: t.Object({ status: t.Optional(proposalStatusSchema) }),
    },
  )

  .post(
    "/proposals",
    async (ctx) => {
      const { body, set, activeWorkspace } = ctx;
      if (!body.title.trim() || !body.proposedContent.trim()) {
        set.status = 400;
        return errorResponse("Title and proposedContent are required");
      }

      const proposal = await createHandbookCaptureProposal(activeWorkspace!.id, {
        title: body.title.trim(),
        slug: body.slug?.trim() || slugifyHandbookTitle(body.title),
        summary: body.summary ?? null,
        proposedContent: body.proposedContent,
        category: body.category?.trim() || "general",
        rationale: body.rationale ?? null,
        sourceProjectId: body.sourceProjectId ?? null,
        sourceFiles: body.sourceFiles ?? [],
        targetEntryId: body.targetEntryId ?? null,
        createdByUserId: currentUserId(ctx),
      });

      set.status = 201;
      return successResponse(proposal);
    },
    {
      body: t.Object({
        title: t.String(),
        slug: t.Optional(t.String()),
        summary: t.Optional(t.Nullable(t.String())),
        proposedContent: t.String(),
        category: t.Optional(t.String()),
        rationale: t.Optional(t.Nullable(t.String())),
        sourceProjectId: t.Optional(t.Nullable(t.String())),
        sourceFiles: t.Optional(t.Array(t.String())),
        targetEntryId: t.Optional(t.Nullable(t.String())),
      }),
    },
  )

  .post(
    "/proposals/:id/approve",
    async (ctx) => {
      const approved = await approveHandbookCaptureProposal(
        ctx.activeWorkspace!.id,
        ctx.params.id,
        currentUserId(ctx),
      );
      if (!approved) {
        ctx.set.status = 404;
        return notFoundResponse("Pending handbook proposal");
      }
      return successResponse(approved);
    },
    { params: t.Object({ id: t.String() }) },
  )

  .post(
    "/proposals/:id/reject",
    async (ctx) => {
      const rejected = await rejectHandbookCaptureProposal(
        ctx.activeWorkspace!.id,
        ctx.params.id,
        currentUserId(ctx),
      );
      if (!rejected) {
        ctx.set.status = 404;
        return notFoundResponse("Handbook proposal");
      }
      return successResponse(rejected);
    },
    { params: t.Object({ id: t.String() }) },
  )

  .get(
    "/:id/chunks",
    async ({ params, activeWorkspace }) => {
      const chunks = await getHandbookEntryChunks(activeWorkspace!.id, params.id);
      return successResponse(chunks);
    },
    { params: t.Object({ id: t.String() }) },
  )

  .get(
    "/:id",
    async ({ params, set, activeWorkspace }) => {
      const entry = await getHandbookEntryById(activeWorkspace!.id, params.id);
      if (!entry) {
        set.status = 404;
        return notFoundResponse("Handbook entry");
      }
      return successResponse(entry);
    },
    { params: t.Object({ id: t.String() }) },
  )

  .patch(
    "/:id",
    async (ctx) => {
      const { body, params, set, activeWorkspace } = ctx;
      if (body.title !== undefined && !body.title.trim()) {
        set.status = 400;
        return errorResponse("Title cannot be empty");
      }
      if (body.content !== undefined && !body.content.trim()) {
        set.status = 400;
        return errorResponse("Content cannot be empty");
      }

      const chunks = body.content !== undefined
        ? await attachEmbeddingsToHandbookChunks(chunkMarkdownContent(body.content))
        : undefined;
      const updated = await updateHandbookEntry(activeWorkspace!.id, params.id, {
        title: body.title?.trim(),
        slug: body.slug?.trim(),
        summary: body.summary,
        content: body.content,
        category: body.category?.trim(),
        status: body.status,
        sourcePath: body.sourcePath,
        sourceProjectId: body.sourceProjectId,
        metadata: body.metadata,
        changeSummary: body.changeSummary,
        createdByUserId: currentUserId(ctx),
      }, chunks);

      if (!updated) {
        set.status = 404;
        return notFoundResponse("Handbook entry");
      }
      return successResponse(updated);
    },
    {
      params: t.Object({ id: t.String() }),
      body: t.Partial(entryBodySchema),
    },
  )

  .delete(
    "/:id",
    async ({ params, set, activeWorkspace }) => {
      const archived = await archiveHandbookEntry(activeWorkspace!.id, params.id);
      if (!archived) {
        set.status = 404;
        return notFoundResponse("Handbook entry");
      }
      return successResponse(archived);
    },
    { params: t.Object({ id: t.String() }) },
  );

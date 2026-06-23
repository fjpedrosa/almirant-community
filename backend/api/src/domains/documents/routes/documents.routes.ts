import { Elysia, t } from "elysia";
import { sessionContextTypes } from "../../../shared/middleware/session-context-types.plugin";
import {
  getDocuments,
  getDocumentById,
  createDocument,
  updateDocument,
  deleteDocument,
  getDocumentsCrossProject,
  searchDocumentsFullText,
  getWorkItemsByDocumentId,
  getDocumentByFilePath,
  createSyncedDocument,
  updateSyncedDocument,
  createDocumentVersion,
  getVersionsByDocumentId,
  getVersionByHash,
  markDocumentAsRead,
  getReadDocumentIds,
  getUncategorizedSyncedDocuments,
  updateDocumentCategoryAssignment,
  getDocsPathByProjectId,
  toggleDocumentFavorite,
  getFavoriteDocuments,
} from "@almirant/database";
import {
  successResponse,
  errorResponse,
  notFoundResponse,
  parsePaginationParams,
  buildPaginationMeta,
} from "../../../shared/services/response";
import { hashDocumentContent } from "../services/document-hasher";
import { uploadDocument, downloadDocument } from "../services/document-storage";
import { isS3Configured } from "../../../shared/services/s3-service";
import { resolveOrCreateCategoryForPath } from "../../integrations/github/services/github-docs-sync-handler";

export const documentsRoutes = new Elysia({ prefix: "/documents" })
  .use(sessionContextTypes)

  // GET /documents - List with pagination and filters
  .get(
    "/",
    async (ctx) => {
      const { query, activeOrganization } = ctx;
      const orgId = activeOrganization!.id;
      const user = (ctx as unknown as Record<string, unknown>).user as { id: string } | null;
      const pagination = parsePaginationParams(query);

      const filters = {
        search: query.search || undefined,
        categoryId: query.categoryId || undefined,
        projectId: query.projectId || undefined,
        isPinned:
          query.isPinned !== undefined
            ? query.isPinned === "true"
            : undefined,
      };

      const { items, total } = await getDocuments(orgId, pagination, filters);

      // Enrich with isRead status when we have a user
      let enrichedItems = items;
      if (user) {
        const docIds = items.map((item) => item.id as string);
        const readSet = await getReadDocumentIds(user.id, docIds);
        enrichedItems = items.map((item) => ({
          ...item,
          isRead: readSet.has(item.id as string),
        }));
      }

      const meta = buildPaginationMeta(pagination.page, pagination.limit, total);

      return successResponse(enrichedItems, meta);
    },
    {
      query: t.Object({
        page: t.Optional(t.String()),
        limit: t.Optional(t.String()),
        search: t.Optional(t.String()),
        categoryId: t.Optional(t.String()),
        projectId: t.Optional(t.String()),
        isPinned: t.Optional(t.String()),
      }),
    }
  )

  // GET /documents/search - Full-text search across all documents
  .get(
    "/search",
    async ({ query, set, activeOrganization }) => {
      const orgId = activeOrganization!.id;
      if (!query.q || query.q.trim() === "") {
        set.status = 400;
        return errorResponse("Search query (q) is required");
      }

      const pagination = parsePaginationParams(query);

      const filters = {
        projectId: query.projectId || undefined,
        categoryId: query.categoryId || undefined,
      };

      const { items, total } = await searchDocumentsFullText(
        orgId,
        query.q.trim(),
        filters,
        { page: pagination.page, limit: pagination.limit }
      );

      const meta = buildPaginationMeta(pagination.page, pagination.limit, total);
      return successResponse(items, meta);
    },
    {
      query: t.Object({
        q: t.String(),
        projectId: t.Optional(t.String()),
        categoryId: t.Optional(t.String()),
        page: t.Optional(t.String()),
        limit: t.Optional(t.String()),
      }),
    }
  )

  // GET /documents/cross-project - Documents grouped by project
  .get(
    "/cross-project",
    async ({ query, activeOrganization }) => {
      const orgId = activeOrganization!.id;
      const filters = {
        search: query.search || undefined,
        categoryId: query.categoryId || undefined,
      };

      const result = await getDocumentsCrossProject(orgId, filters);
      return successResponse(result.groups);
    },
    {
      query: t.Object({
        search: t.Optional(t.String()),
        categoryId: t.Optional(t.String()),
      }),
    }
  )

  // POST /documents - Create document
  .post(
    "/",
    async ({ body, set, activeOrganization }) => {
      const orgId = activeOrganization!.id;
      if (!body.title || body.title.trim() === "") {
        set.status = 400;
        return errorResponse("Title is required");
      }

      const doc = await createDocument(orgId, {
        title: body.title.trim(),
        content: body.content,
        categoryId: body.categoryId,
        projectId: body.projectId,
      });

      set.status = 201;
      return successResponse(doc);
    },
    {
      body: t.Object({
        title: t.String(),
        content: t.Optional(t.String()),
        categoryId: t.Optional(t.String()),
        projectId: t.Optional(t.String()),
      }),
    }
  )

  // GET /documents/favorites - List current user's favorite documents
  .get(
    "/favorites",
    async (ctx) => {
      const user = (ctx as unknown as Record<string, unknown>).user as { id: string } | null;
      if (!user) {
        ctx.set.status = 401;
        return errorResponse("Unauthorized", 401);
      }

      const orgId = ctx.activeOrganization!.id;
      const favorites = await getFavoriteDocuments(user.id, orgId);
      return successResponse(favorites);
    }
  )

  // POST /documents/sync - Sync documents from repository
  .post(
    "/sync",
    async ({ body, set, activeOrganization }) => {
      const orgId = activeOrganization!.id;
      if (!isS3Configured()) {
        set.status = 503;
        return errorResponse("S3 storage is not configured");
      }

      if (body.files.length === 0) {
        return successResponse({ synced: 0, skipped: 0, created: 0, total: 0 });
      }

      let synced = 0;
      let skipped = 0;
      let created = 0;

      for (const file of body.files) {
        if (!file.filePath && !file.path) {
          set.status = 400;
          return errorResponse("Each file must include filePath (or legacy path)");
        }

        const contentHash = hashDocumentContent(file.content);
        const filePath = file.filePath ?? file.path ?? "";
        const title = file.title ?? filePath.split("/").pop()?.replace(/\.md$/i, "") ?? filePath;

        // Check if document exists by filePath + projectId
        const existing = await getDocumentByFilePath(orgId, filePath, body.projectId);

        if (existing) {
          // Document exists - check if content changed
          if (existing.contentHash === contentHash) {
            skipped++;
            continue;
          }

          // Content changed - upload new version to S3
          const s3Key = await uploadDocument(
            body.projectId,
            filePath,
            file.content,
            contentHash
          );

          // Update document record
          await updateSyncedDocument(orgId, existing.id, {
            title,
            content: file.content,
            contentHash,
            s3Key,
            filePath,
          });

          // Create version record
          await createDocumentVersion({
            documentId: existing.id,
            contentHash,
            s3Key,
            commitSha: body.commitSha,
          });

          synced++;
        } else {
          // New document - upload to S3
          const s3Key = await uploadDocument(
            body.projectId,
            filePath,
            file.content,
            contentHash
          );

          // Create document
          const doc = await createSyncedDocument(orgId, {
            title,
            content: file.content,
            projectId: body.projectId,
            filePath,
            contentHash,
            s3Key,
          });

          // Create first version
          await createDocumentVersion({
            documentId: doc.id,
            contentHash,
            s3Key,
            commitSha: body.commitSha,
          });

          created++;
        }
      }

      return successResponse({
        synced,
        skipped,
        created,
        total: body.files.length,
      });
    },
    {
      body: t.Object({
        projectId: t.String(),
        commitSha: t.Optional(t.String()),
        files: t.Array(
          t.Object({
            filePath: t.Optional(t.String()),
            path: t.Optional(t.String()),
            title: t.Optional(t.String()),
            content: t.String(),
          })
        ),
      }),
    }
  )

  // GET /documents/:id - Get by ID
  .get(
    "/:id",
    async ({ params, set, activeOrganization }) => {
      const orgId = activeOrganization!.id;
      const doc = await getDocumentById(orgId, params.id);

      if (!doc) {
        set.status = 404;
        return notFoundResponse("Document");
      }

      return successResponse(doc);
    },
    {
      params: t.Object({
        id: t.String(),
      }),
    }
  )

  // PATCH /documents/:id - Update
  .patch(
    "/:id",
    async ({ params, body, set, activeOrganization }) => {
      const orgId = activeOrganization!.id;
      const updated = await updateDocument(orgId, params.id, {
        title: body.title,
        content: body.content,
        categoryId: body.categoryId,
        projectId: body.projectId,
        isPinned: body.isPinned,
      });

      if (!updated) {
        set.status = 404;
        return notFoundResponse("Document");
      }

      return successResponse(updated);
    },
    {
      params: t.Object({
        id: t.String(),
      }),
      body: t.Object({
        title: t.Optional(t.String()),
        content: t.Optional(t.String()),
        categoryId: t.Optional(t.Nullable(t.String())),
        projectId: t.Optional(t.Nullable(t.String())),
        isPinned: t.Optional(t.Boolean()),
      }),
    }
  )

  // DELETE /documents/:id - Delete
  .delete(
    "/:id",
    async ({ params, set, activeOrganization }) => {
      const orgId = activeOrganization!.id;
      const deleted = await deleteDocument(orgId, params.id);

      if (!deleted) {
        set.status = 404;
        return notFoundResponse("Document");
      }

      return successResponse({ deleted: true });
    },
    {
      params: t.Object({
        id: t.String(),
      }),
    }
  )

  // POST /documents/:id/read - Mark document as read by current user
  .post(
    "/:id/read",
    async (ctx) => {
      const user = (ctx as unknown as Record<string, unknown>).user as { id: string } | null;
      if (!user) {
        ctx.set.status = 401;
        return errorResponse("Unauthorized", 401);
      }

      await markDocumentAsRead(user.id, ctx.params.id);
      return successResponse({ read: true });
    },
    {
      params: t.Object({
        id: t.String(),
      }),
    }
  )

  // POST /documents/:id/favorite - Toggle favorite for current user
  .post(
    "/:id/favorite",
    async (ctx) => {
      const user = (ctx as unknown as Record<string, unknown>).user as { id: string } | null;
      if (!user) {
        ctx.set.status = 401;
        return errorResponse("Unauthorized", 401);
      }

      const orgId = ctx.activeOrganization!.id;
      const result = await toggleDocumentFavorite(user.id, ctx.params.id, orgId);
      if (!result) {
        ctx.set.status = 404;
        return notFoundResponse("Document");
      }

      return successResponse(result);
    },
    {
      params: t.Object({
        id: t.String(),
      }),
    }
  )

  // GET /documents/:id/work-items - List linked work items
  .get(
    "/:id/work-items",
    async ({ params }) => {
      const workItems = await getWorkItemsByDocumentId(params.id);
      return successResponse(workItems);
    },
    {
      params: t.Object({
        id: t.String(),
      }),
    }
  )

  // GET /documents/:id/versions - List document versions
  .get(
    "/:id/versions",
    async ({ params, query }) => {
      const pagination = parsePaginationParams(query);

      const { items, total } = await getVersionsByDocumentId(params.id, {
        limit: pagination.limit,
        offset: pagination.offset,
      });

      const meta = buildPaginationMeta(pagination.page, pagination.limit, total);
      return successResponse(items, meta);
    },
    {
      params: t.Object({
        id: t.String(),
      }),
      query: t.Object({
        page: t.Optional(t.String()),
        limit: t.Optional(t.String()),
      }),
    }
  )

  // GET /documents/:id/versions/:contentHash/content - Get version content from S3
  .get(
    "/:id/versions/:contentHash/content",
    async ({ params, set }) => {
      if (!isS3Configured()) {
        set.status = 503;
        return errorResponse("S3 storage is not configured");
      }

      const version = await getVersionByHash(params.id, params.contentHash);

      if (!version) {
        set.status = 404;
        return notFoundResponse("Document version");
      }

      const content = await downloadDocument(version.s3Key);
      return successResponse({ content });
    },
    {
      params: t.Object({
        id: t.String(),
        contentHash: t.String(),
      }),
    }
  )

  // POST /documents/recategorize - Re-assign categories based on folder structure
  .post(
    "/recategorize",
    async (ctx) => {
      const { body, set, activeOrganization } = ctx;
      const orgId = activeOrganization!.id;

      const docsPath = (await getDocsPathByProjectId(body.projectId)) || "docs/";
      const uncategorized = await getUncategorizedSyncedDocuments(body.projectId);

      if (uncategorized.length === 0) {
        return successResponse({ recategorized: 0, total: 0 });
      }

      let recategorized = 0;

      for (const doc of uncategorized) {
        const categoryId = await resolveOrCreateCategoryForPath(orgId, doc.filePath, docsPath);
        if (categoryId) {
          await updateDocumentCategoryAssignment(orgId, doc.id, categoryId);
          recategorized++;
        }
      }

      return successResponse({ recategorized, total: uncategorized.length });
    },
    {
      body: t.Object({
        projectId: t.String(),
      }),
    }
  );

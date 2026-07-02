import { Elysia, t } from "elysia";
import {
  validateApiKey,
  getDocumentByFilePath,
  getDocumentByTitleAndProject,
  db,
  sql,
  createSyncedDocument,
  updateSyncedDocument,
  updateDocumentCategoryAssignment,
  createDocumentVersion,
  getDocumentCategories,
  createDocumentCategory,
  getDocumentCategoryByNameAndParent,
  getWorkspaceIdByProjectId,
} from "@almirant/database";
import { successResponse, errorResponse } from "../../../shared/services/response";
import { hashDocumentContent } from "../services/document-hasher";
import { uploadDocument } from "../services/document-storage";
import { isS3Configured, uploadBufferToS3 } from "../../../shared/services/s3-service";

const requireSyncApiKey = async (request: Request): Promise<boolean> => {
  const authHeader = request.headers.get("authorization");
  if (!authHeader?.startsWith("Bearer ")) return false;
  const raw = authHeader.slice(7);
  const apiKey = await validateApiKey(raw);
  return !!apiKey;
};

/** Detect schema-related errors (missing columns, type mismatches) */
const isSchemaColumnError = (error: unknown): boolean => {
  const message = error instanceof Error ? error.message : String(error ?? "");
  const lower = message.toLowerCase();
  return lower.includes("does not exist") || lower.includes("file_path") || lower.includes("failed query");
};

const computeContentMetrics = (content: string) => {
  const normalized = content?.trim() ?? "";
  const wordCount = normalized.length > 0 ? normalized.split(/\s+/).filter(Boolean).length : 0;
  const sizeBytes = new TextEncoder().encode(content ?? "").length;
  return { wordCount, sizeBytes };
};

const getDocumentsTableColumns = async (): Promise<Set<string>> => {
  const rows = (await db.execute(sql<{ column_name: string }>`
    select column_name
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'documents'
  `)) as unknown as Array<{ column_name: string }>;

  return new Set(rows.map((row) => row.column_name));
};

const ensureLegacyRequiredColumns = (columns: Set<string>) => {
  const required = ["title", "content", "project_id"];
  const missing = required.filter((column) => !columns.has(column));
  if (missing.length > 0) {
    throw new Error(
      `[documents-sync] Legacy sync mode missing required columns in documents table: ${missing.join(", ")}`
    );
  }
};

export const documentsSyncRoutes = new Elysia({ prefix: "/sync/documents" })
  .onBeforeHandle(async ({ request, set }) => {
    const ok = await requireSyncApiKey(request);
    if (!ok) {
      set.status = 401;
      return errorResponse("Unauthorized");
    }
  })

  // GET /sync/documents/categories - List all document categories
  .get(
    "/categories",
    async ({ query, set }) => {
      if (!query.workspaceId) {
        set.status = 400;
        return errorResponse("workspaceId query parameter is required");
      }
      const categories = await getDocumentCategories(query.workspaceId);
      return successResponse(categories);
    },
    {
      query: t.Object({
        workspaceId: t.Optional(t.String()),
      }),
    }
  )

  // POST /sync/documents/categories - Create or get category by name (idempotent)
  .post(
    "/categories",
    async ({ body, set }) => {
      // Resolve workspaceId: accept directly or resolve from projectId
      let orgId = body.workspaceId;
      if (!orgId && body.projectId) {
        orgId = await getWorkspaceIdByProjectId(body.projectId) ?? undefined;
      }
      if (!orgId) {
        set.status = 400;
        return errorResponse("workspaceId or projectId is required");
      }

      if (!body.name || body.name.trim() === "") {
        set.status = 400;
        return errorResponse("Category name is required");
      }

      // Check if category already exists by name + parentId
      const found = await getDocumentCategoryByNameAndParent(
        orgId,
        body.name,
        body.parentId
      );

      if (found) {
        return successResponse(found);
      }

      // Create new category
      const category = await createDocumentCategory(orgId, {
        name: body.name.trim(),
        color: body.color,
        icon: body.icon,
        parentId: body.parentId,
      });

      set.status = 201;
      return successResponse(category);
    },
    {
      body: t.Object({
        workspaceId: t.Optional(t.String()),
        projectId: t.Optional(t.String()),
        name: t.String(),
        color: t.Optional(t.String()),
        icon: t.Optional(t.String()),
        parentId: t.Optional(t.String()),
      }),
    }
  )

  // POST /sync/documents - Sync documents from repository (with categoryId per file)
  .post(
    "/",
    async ({ body, set }) => {
      if (!isS3Configured()) {
        set.status = 503;
        return errorResponse("S3 storage is not configured");
      }

      // Resolve workspaceId from projectId
      const orgId = await getWorkspaceIdByProjectId(body.projectId);
      if (!orgId) {
        set.status = 400;
        return errorResponse("Could not resolve workspace for the given projectId");
      }

      if (body.files.length === 0) {
        return successResponse({ synced: 0, skipped: 0, created: 0, total: 0 });
      }

      // Proactive schema drift detection: Drizzle's .insert() generates SQL with
      // ALL columns from the schema definition. If the production DB is missing any
      // (e.g. search_vector from a not-yet-applied migration), the INSERT fails.
      // Detect this upfront and route writes through column-aware raw SQL.
      const drizzleDocumentColumns = [
        'id', 'title', 'content', 'category_id', 'project_id', 'word_count',
        'size_bytes', 'is_pinned', 'content_hash', 's3_key', 'file_path',
        'search_vector', 'archived_at', 'created_at', 'updated_at',
      ];
      const actualDbColumns = await getDocumentsTableColumns();
      const missingColumns = drizzleDocumentColumns.filter(col => !actualDbColumns.has(col));

      let synced = 0;
      let skipped = 0;
      let created = 0;
      let useLegacyDocumentSchema = missingColumns.length > 0;
      let legacyModeWarned = useLegacyDocumentSchema;
      let legacyDocumentColumns: Set<string> | null = useLegacyDocumentSchema ? actualDbColumns : null;

      if (useLegacyDocumentSchema) {
        ensureLegacyRequiredColumns(actualDbColumns);
        console.warn(
          `[documents-sync] Schema drift detected (missing: ${missingColumns.join(', ')}). Using column-aware writes.`
        );
      }

      for (const file of body.files) {
        if (!file.filePath) {
          set.status = 400;
          return errorResponse("Each file must include filePath");
        }

        const contentHash = hashDocumentContent(file.content);
        const filePath = file.filePath;
        const title =
          file.title ??
          filePath.split("/").pop()?.replace(/\.md$/i, "") ??
          filePath;

        // Check if document exists by filePath + projectId.
        // If the target DB does not yet have documents.file_path, automatically
        // fallback to legacy sync behavior (title + project matching).
        let existing:
          | {
              id: string;
              content: string | null;
              contentHash?: string | null;
              categoryId?: string | null;
            }
          | null = null;

        if (useLegacyDocumentSchema) {
          existing = await getDocumentByTitleAndProject(orgId, title, body.projectId);
        } else {
          try {
            existing = await getDocumentByFilePath(orgId, filePath, body.projectId);
          } catch (error) {
            if (!isSchemaColumnError(error)) throw error;

            useLegacyDocumentSchema = true;
            if (!legacyDocumentColumns) {
              legacyDocumentColumns = await getDocumentsTableColumns();
              ensureLegacyRequiredColumns(legacyDocumentColumns);
            }
            if (!legacyModeWarned) {
              legacyModeWarned = true;
              console.warn(
                "[documents-sync] Falling back to legacy sync mode (SELECT failed, likely missing column)"
              );
            }

            existing = await getDocumentByTitleAndProject(orgId, title, body.projectId);
          }
        }

        if (useLegacyDocumentSchema) {
          if (!legacyDocumentColumns) {
            legacyDocumentColumns = await getDocumentsTableColumns();
            ensureLegacyRequiredColumns(legacyDocumentColumns);
          }

          if (existing) {
            const existingContent = existing.content ?? "";
            const categoryChanged = file.categoryId && file.categoryId !== existing.categoryId;
            if (existingContent === file.content && !categoryChanged) {
              skipped++;
              continue;
            }

            const metrics = computeContentMetrics(file.content);
            const updateAssignments = [
              sql`title = ${title}`,
              sql`content = ${file.content}`,
              sql`project_id = ${body.projectId}`,
            ];

            if (legacyDocumentColumns.has("category_id")) {
              updateAssignments.push(sql`category_id = ${file.categoryId ?? null}`);
            }
            if (legacyDocumentColumns.has("word_count")) {
              updateAssignments.push(sql`word_count = ${metrics.wordCount}`);
            }
            if (legacyDocumentColumns.has("size_bytes")) {
              updateAssignments.push(sql`size_bytes = ${metrics.sizeBytes}`);
            }
            if (legacyDocumentColumns.has("content_hash")) {
              updateAssignments.push(sql`content_hash = ${contentHash}`);
            }
            if (legacyDocumentColumns.has("file_path")) {
              updateAssignments.push(sql`file_path = ${filePath}`);
            }
            if (legacyDocumentColumns.has("updated_at")) {
              updateAssignments.push(sql`updated_at = now()`);
            }

            await db.execute(
              sql`update documents set ${sql.join(updateAssignments, sql`, `)} where id = ${existing.id}`
            );

            synced++;
            continue;
          }

          const metrics = computeContentMetrics(file.content);
          const insertColumns = [sql`title`, sql`content`, sql`project_id`];
          const insertValues = [sql`${title}`, sql`${file.content}`, sql`${body.projectId}`];

          if (legacyDocumentColumns.has("category_id")) {
            insertColumns.push(sql`category_id`);
            insertValues.push(sql`${file.categoryId ?? null}`);
          }
          if (legacyDocumentColumns.has("word_count")) {
            insertColumns.push(sql`word_count`);
            insertValues.push(sql`${metrics.wordCount}`);
          }
          if (legacyDocumentColumns.has("size_bytes")) {
            insertColumns.push(sql`size_bytes`);
            insertValues.push(sql`${metrics.sizeBytes}`);
          }
          if (legacyDocumentColumns.has("content_hash")) {
            insertColumns.push(sql`content_hash`);
            insertValues.push(sql`${contentHash}`);
          }
          if (legacyDocumentColumns.has("file_path")) {
            insertColumns.push(sql`file_path`);
            insertValues.push(sql`${filePath}`);
          }
          if (legacyDocumentColumns.has("is_pinned")) {
            insertColumns.push(sql`is_pinned`);
            insertValues.push(sql`false`);
          }
          if (legacyDocumentColumns.has("created_at")) {
            insertColumns.push(sql`created_at`);
            insertValues.push(sql`now()`);
          }
          if (legacyDocumentColumns.has("updated_at")) {
            insertColumns.push(sql`updated_at`);
            insertValues.push(sql`now()`);
          }

          await db.execute(
            sql`insert into documents (${sql.join(insertColumns, sql`, `)}) values (${sql.join(insertValues, sql`, `)})`
          );

          created++;
          continue;
        }

        // Non-legacy path: Drizzle ORM writes with S3 versioning.
        // Wrapped in try-catch as safety net — if a Drizzle write fails (e.g.
        // schema drift missed by proactive check), switch to legacy mode.
        try {
          if (existing) {
            // Document exists - check if content changed
            const categoryChanged = file.categoryId && file.categoryId !== existing.categoryId;
            if (existing.contentHash === contentHash && !categoryChanged) {
              skipped++;
              continue;
            }

            // Only categoryId changed (content unchanged) — update metadata only
            if (existing.contentHash === contentHash && categoryChanged) {
              await updateDocumentCategoryAssignment(orgId, existing.id, file.categoryId!);
              synced++;
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
              categoryId: file.categoryId,
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
              categoryId: file.categoryId,
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
        } catch (writeError) {
          // Safety net: if Drizzle write fails, switch to legacy mode for this
          // file and all subsequent files. This handles edge cases the proactive
          // column check might miss (trigger failures, type mismatches, etc.).
          if (!isSchemaColumnError(writeError)) throw writeError;

          useLegacyDocumentSchema = true;
          if (!legacyDocumentColumns) {
            legacyDocumentColumns = await getDocumentsTableColumns();
            ensureLegacyRequiredColumns(legacyDocumentColumns);
          }
          console.warn(
            `[documents-sync] Drizzle write failed, falling back to legacy mode: ${
              writeError instanceof Error ? writeError.message.substring(0, 200) : String(writeError)
            }`
          );

          // Re-process current file using legacy column-aware INSERT
          const metrics = computeContentMetrics(file.content);
          const legacyExisting = existing
            ?? await getDocumentByTitleAndProject(orgId, title, body.projectId);

          if (legacyExisting) {
            const existingContent = legacyExisting.content ?? "";
            const categoryChanged = file.categoryId && file.categoryId !== legacyExisting.categoryId;
            if (existingContent === file.content && !categoryChanged) {
              skipped++;
              continue;
            }

            const updateAssignments = [
              sql`title = ${title}`,
              sql`content = ${file.content}`,
              sql`project_id = ${body.projectId}`,
            ];
            if (legacyDocumentColumns.has("category_id")) {
              updateAssignments.push(sql`category_id = ${file.categoryId ?? null}`);
            }
            if (legacyDocumentColumns.has("word_count")) {
              updateAssignments.push(sql`word_count = ${metrics.wordCount}`);
            }
            if (legacyDocumentColumns.has("size_bytes")) {
              updateAssignments.push(sql`size_bytes = ${metrics.sizeBytes}`);
            }
            if (legacyDocumentColumns.has("content_hash")) {
              updateAssignments.push(sql`content_hash = ${contentHash}`);
            }
            if (legacyDocumentColumns.has("file_path")) {
              updateAssignments.push(sql`file_path = ${filePath}`);
            }
            if (legacyDocumentColumns.has("updated_at")) {
              updateAssignments.push(sql`updated_at = now()`);
            }

            await db.execute(
              sql`update documents set ${sql.join(updateAssignments, sql`, `)} where id = ${legacyExisting.id}`
            );
            synced++;
          } else {
            const insertColumns = [sql`title`, sql`content`, sql`project_id`];
            const insertValues = [sql`${title}`, sql`${file.content}`, sql`${body.projectId}`];

            if (legacyDocumentColumns.has("category_id")) {
              insertColumns.push(sql`category_id`);
              insertValues.push(sql`${file.categoryId ?? null}`);
            }
            if (legacyDocumentColumns.has("word_count")) {
              insertColumns.push(sql`word_count`);
              insertValues.push(sql`${metrics.wordCount}`);
            }
            if (legacyDocumentColumns.has("size_bytes")) {
              insertColumns.push(sql`size_bytes`);
              insertValues.push(sql`${metrics.sizeBytes}`);
            }
            if (legacyDocumentColumns.has("content_hash")) {
              insertColumns.push(sql`content_hash`);
              insertValues.push(sql`${contentHash}`);
            }
            if (legacyDocumentColumns.has("file_path")) {
              insertColumns.push(sql`file_path`);
              insertValues.push(sql`${filePath}`);
            }
            if (legacyDocumentColumns.has("is_pinned")) {
              insertColumns.push(sql`is_pinned`);
              insertValues.push(sql`false`);
            }
            if (legacyDocumentColumns.has("created_at")) {
              insertColumns.push(sql`created_at`);
              insertValues.push(sql`now()`);
            }
            if (legacyDocumentColumns.has("updated_at")) {
              insertColumns.push(sql`updated_at`);
              insertValues.push(sql`now()`);
            }

            await db.execute(
              sql`insert into documents (${sql.join(insertColumns, sql`, `)}) values (${sql.join(insertValues, sql`, `)})`
            );
            created++;
          }
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
            filePath: t.String(),
            title: t.Optional(t.String()),
            content: t.String(),
            categoryId: t.Optional(t.String()),
          })
        ),
      }),
    }
  )

  // POST /sync/documents/assets - Upload asset files (images) to S3
  .post(
    "/assets",
    async ({ body, set }) => {
      if (!isS3Configured()) {
        set.status = 503;
        return errorResponse("S3 storage is not configured");
      }

      if (body.assets.length === 0) {
        return successResponse({ uploaded: 0 });
      }

      let uploaded = 0;

      for (const asset of body.assets) {
        const buffer = Buffer.from(asset.content, "base64");
        const s3Key = `doc-assets/${body.projectId}/${asset.path}`;
        await uploadBufferToS3(buffer, s3Key, asset.mimeType);
        uploaded++;
      }

      return successResponse({ uploaded });
    },
    {
      body: t.Object({
        projectId: t.String(),
        assets: t.Array(
          t.Object({
            path: t.String(),
            content: t.String(),
            mimeType: t.String(),
          })
        ),
      }),
    }
  );

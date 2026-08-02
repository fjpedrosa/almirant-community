import { Elysia, t } from "elysia";
import type { UserStorageObjectDb } from "@almirant/database";
import { logger } from "@almirant/config";
import { sessionContextTypes } from "../../../shared/middleware/session-context-types.plugin";
import { errorResponse, successResponse } from "../../../shared/services/response";
import { normalizeUserStoragePath } from "../services/user-storage-policy";
import type { UserStorageService } from "../services/user-storage-service";
import { userStorageService } from "../services/user-storage-runtime";

export const MAX_USER_STORAGE_UPLOAD_BYTES = 25 * 1024 * 1024;

const CONTROL_CHARACTER_RE = /[\u0000-\u001f\u007f]/g;
const HAS_CONTROL_CHARACTER_RE = /[\u0000-\u001f\u007f]/;
const SAFE_CONTENT_TYPE_RE =
  /^[A-Za-z0-9!#$&^_.+-]+\/[A-Za-z0-9!#$&^_.+*-]+(?:\s*;\s*[A-Za-z0-9!#$&^_.+-]+=(?:[A-Za-z0-9!#$&^_.+*-]+|"[^"]*"))*$/;

const sanitizeFileName = (rawName: string): string => {
  const name = rawName
    .replace(CONTROL_CHARACTER_RE, "")
    .replace(/[\\/]/g, "_")
    .trim()
    .slice(0, 255);
  return name || "file";
};

const sanitizeContentType = (contentType: string): string => {
  const candidate = contentType.trim().slice(0, 255);
  return candidate &&
    !HAS_CONTROL_CHARACTER_RE.test(candidate) &&
    SAFE_CONTENT_TYPE_RE.test(candidate)
    ? candidate
    : "application/octet-stream";
};

const encodeContentDispositionFileName = (fileName: string): string => {
  const safeName = sanitizeFileName(fileName);
  const asciiFallback = safeName
    .replace(/[^\x20-\x7e]/g, "_")
    .replace(/["\\]/g, "_");
  const encoded = encodeURIComponent(safeName).replace(/[!'()*]/g, (character) =>
    `%${character.charCodeAt(0).toString(16).toUpperCase()}`,
  );
  return `attachment; filename="${asciiFallback}"; filename*=UTF-8''${encoded}`;
};

export const serializeUserStorageObject = (object: UserStorageObjectDb) => ({
  id: object.id,
  virtualPath: object.virtualPath,
  fileName: object.fileName,
  contentType: object.contentType,
  sizeBytes: object.sizeBytes,
  checksumSha256: object.checksumSha256,
  kind: object.kind,
  downloadUrl: `/api/storage/files/${object.id}`,
  createdAt: object.createdAt.toISOString(),
  updatedAt: object.updatedAt.toISOString(),
});

const getErrorCode = (error: unknown): string | undefined => {
  if (!error || typeof error !== "object" || !("code" in error)) return undefined;
  return typeof error.code === "string" ? error.code : undefined;
};

const handleStorageError = (
  error: unknown,
  set: { status?: number | string },
  operation: string,
) => {
  const code = getErrorCode(error);
  if (code === "USER_STORAGE_QUOTA_EXCEEDED") {
    set.status = 413;
    return errorResponse("User storage quota exceeded", 413, code);
  }
  if (code === "USER_STORAGE_UNAVAILABLE") {
    set.status = 503;
    return errorResponse("Private user storage is not configured", 503, code);
  }

  logger.error({ error, operation }, "User storage operation failed");
  set.status = 500;
  return errorResponse("User storage operation failed", 500);
};

export const createUserStorageRoutes = (
  service: UserStorageService = userStorageService,
) =>
  new Elysia({ prefix: "/storage" })
    .use(sessionContextTypes)
    .get("/usage", async ({ user, set }) => {
      if (!user) {
        set.status = 401;
        return errorResponse("Unauthorized", 401);
      }

      try {
        const usage = await service.usage(user.id);
        set.headers["Cache-Control"] = "private, no-store";
        return successResponse({
          quotaBytes: usage.quotaBytes,
          usedBytes: usage.usedBytes,
          reservedBytes: usage.reservedBytes,
          availableBytes: Math.max(
            usage.quotaBytes - usage.usedBytes - usage.reservedBytes,
            0,
          ),
          quotaObjects: usage.quotaObjects,
          usedObjects: usage.usedObjects,
          reservedObjects: usage.reservedObjects,
          availableObjects: Math.max(
            usage.quotaObjects - usage.usedObjects - usage.reservedObjects,
            0,
          ),
        });
      } catch (error) {
        return handleStorageError(error, set, "usage");
      }
    })
    .get(
      "/files",
      async ({ user, query, set }) => {
        if (!user) {
          set.status = 401;
          return errorResponse("Unauthorized", 401);
        }

        try {
          const objects = await service.list(user.id, {
            prefix: query.prefix?.trim() || undefined,
            search: query.search?.trim() || undefined,
            limit: query.limit,
          });
          set.headers["Cache-Control"] = "private, no-store";
          return successResponse(objects.map(serializeUserStorageObject));
        } catch (error) {
          return handleStorageError(error, set, "list");
        }
      },
      {
        query: t.Object({
          prefix: t.Optional(t.String({ maxLength: 512 })),
          search: t.Optional(t.String({ maxLength: 200 })),
          limit: t.Optional(t.Numeric({ minimum: 1, maximum: 200 })),
        }),
      },
    )
    .post(
      "/files",
      async ({ user, body, set }) => {
        if (!user) {
          set.status = 401;
          return errorResponse("Unauthorized", 401);
        }

        const file = body.file;
        if (file.size > MAX_USER_STORAGE_UPLOAD_BYTES) {
          set.status = 413;
          return errorResponse("File size exceeds the 25 MiB upload limit", 413);
        }

        const fileName = sanitizeFileName(file.name);
        let virtualPath: string;
        try {
          virtualPath = normalizeUserStoragePath(body.path?.trim() || fileName);
        } catch (error) {
          set.status = 400;
          return errorResponse(
            error instanceof Error ? error.message : "Invalid storage path",
            400,
          );
        }

        try {
          const object = await service.put({
            ownerUserId: user.id,
            workspaceId: null,
            virtualPath,
            fileName,
            contentType: sanitizeContentType(file.type),
            bytes: new Uint8Array(await file.arrayBuffer()),
            kind: "file",
            metadata: { source: "rest_upload" },
          });
          set.status = 201;
          return successResponse(serializeUserStorageObject(object));
        } catch (error) {
          return handleStorageError(error, set, "upload");
        }
      },
      {
        body: t.Object({
          file: t.File({ maxSize: MAX_USER_STORAGE_UPLOAD_BYTES }),
          path: t.Optional(t.String({ maxLength: 512 })),
        }),
      },
    )
    .get(
      "/files/:id",
      async ({ user, params, set }) => {
        if (!user) {
          set.status = 401;
          return errorResponse("Unauthorized", 401);
        }

        try {
          const result = await service.read(user.id, params.id);
          if (!result) {
            set.status = 404;
            return errorResponse("File not found", 404);
          }

          return new Response(result.bytes, {
            headers: {
              "Content-Type": sanitizeContentType(result.object.contentType),
              "Content-Length": String(result.bytes.byteLength),
              "Content-Disposition": encodeContentDispositionFileName(
                result.object.fileName,
              ),
              "Cache-Control": "private, no-store",
              "X-Content-Type-Options": "nosniff",
            },
          });
        } catch (error) {
          return handleStorageError(error, set, "download");
        }
      },
      { params: t.Object({ id: t.String({ format: "uuid" }) }) },
    )
    .delete(
      "/files/:id",
      async ({ user, params, set }) => {
        if (!user) {
          set.status = 401;
          return errorResponse("Unauthorized", 401);
        }

        try {
          const removed = await service.remove(user.id, params.id);
          if (!removed) {
            set.status = 404;
            return errorResponse("File not found", 404);
          }
          return successResponse({ deleted: true });
        } catch (error) {
          return handleStorageError(error, set, "delete");
        }
      },
      { params: t.Object({ id: t.String({ format: "uuid" }) }) },
    );

export const userStorageRoutes = createUserStorageRoutes();

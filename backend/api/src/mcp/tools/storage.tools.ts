import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { UserStorageObjectDb } from "@almirant/database";
import { z } from "zod";
import type { UserStorageService } from "../../domains/storage/services/user-storage-service";
import { userStorageService } from "../../domains/storage/services/user-storage-runtime";
import { normalizeUserStoragePath } from "../../domains/storage/services/user-storage-policy";
import {
  getPermissionsFromExtra,
  getUserIdFromExtra,
  type McpToolResult,
} from "../setup";

export const MAX_MCP_STORAGE_PAYLOAD_BYTES = 1024 * 1024;
const MAX_BASE64_CHARACTERS = Math.ceil(MAX_MCP_STORAGE_PAYLOAD_BYTES / 3) * 4;
const CONTROL_CHARACTER_RE = /[\u0000-\u001f\u007f]/;
const SAFE_CONTENT_TYPE_RE =
  /^[A-Za-z0-9!#$&^_.+-]+\/[A-Za-z0-9!#$&^_.+*-]+(?:\s*;\s*[A-Za-z0-9!#$&^_.+-]+=(?:[A-Za-z0-9!#$&^_.+*-]+|"[^"]*"))*$/;

type McpExtra = { authInfo?: { extra?: Record<string, unknown> } };
type RequiredPermission = "mcp:read" | "mcp:write";

const errorResult = (message: string): McpToolResult => ({
  content: [{ type: "text", text: `Error: ${message}` }],
  isError: true,
});

const getStorageActor = (
  extra: McpExtra,
  permission: RequiredPermission,
): string | McpToolResult => {
  const userId = getUserIdFromExtra(extra);
  if (!userId) {
    return errorResult("user storage requires an authenticated user actor");
  }
  if (!getPermissionsFromExtra(extra).includes(permission)) {
    return errorResult(`token is missing required permission: ${permission}`);
  }
  return userId;
};

const serializeStorageObject = (object: UserStorageObjectDb) => ({
  id: object.id,
  path: object.virtualPath,
  fileName: object.fileName,
  contentType: object.contentType,
  sizeBytes: object.sizeBytes,
  checksumSha256: object.checksumSha256,
  kind: object.kind,
  createdAt: object.createdAt.toISOString(),
  updatedAt: object.updatedAt.toISOString(),
});

const jsonResult = (value: unknown): McpToolResult => ({
  content: [{ type: "text", text: JSON.stringify(value, null, 2) }],
});

const getKnownErrorMessage = (error: unknown): string => {
  if (!error || typeof error !== "object") return "user storage operation failed";
  const code = "code" in error && typeof error.code === "string" ? error.code : undefined;
  if (code === "USER_STORAGE_QUOTA_EXCEEDED") return "user storage quota exceeded";
  if (code === "USER_STORAGE_UNAVAILABLE") return "private user storage is not configured";
  if (error instanceof Error && error.message.startsWith("Storage path")) {
    return error.message;
  }
  return "user storage operation failed";
};

const decodeStrictBase64 = (value: string): Uint8Array => {
  if (
    value.length > MAX_BASE64_CHARACTERS ||
    value.length % 4 !== 0 ||
    !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)
  ) {
    throw new Error("base64 payload is malformed or too large");
  }
  const bytes = new Uint8Array(Buffer.from(value, "base64"));
  if (Buffer.from(bytes).toString("base64") !== value) {
    throw new Error("base64 payload is malformed");
  }
  return bytes;
};

const getWriteBytes = (params: {
  content?: string;
  base64?: string;
}): Uint8Array => {
  const hasText = typeof params.content === "string";
  const hasBase64 = typeof params.base64 === "string";
  if (hasText === hasBase64) {
    throw new Error("provide exactly one of content or base64");
  }

  const bytes = hasText
    ? new TextEncoder().encode(params.content)
    : decodeStrictBase64(params.base64!);
  if (bytes.byteLength > MAX_MCP_STORAGE_PAYLOAD_BYTES) {
    throw new Error(
      `payload exceeds the ${MAX_MCP_STORAGE_PAYLOAD_BYTES}-byte MCP storage limit`,
    );
  }
  return bytes;
};

const getWriteContentType = (params: {
  content?: string;
  contentType?: string;
}): string => {
  if (params.contentType === undefined) {
    return typeof params.content === "string"
      ? "text/plain; charset=utf-8"
      : "application/octet-stream";
  }

  const contentType = params.contentType.trim();
  if (
    !contentType ||
    contentType.length > 255 ||
    CONTROL_CHARACTER_RE.test(contentType) ||
    !SAFE_CONTENT_TYPE_RE.test(contentType)
  ) {
    throw new Error("contentType is invalid");
  }
  return contentType;
};

export const registerStorageTools = (
  server: McpServer,
  service: UserStorageService = userStorageService,
) => {
  server.tool(
    "storage_usage",
    "Get private account storage quota and usage for the authenticated user.",
    {},
    async (_params, extra) => {
      const actor = getStorageActor(extra, "mcp:read");
      if (typeof actor !== "string") return actor;
      try {
        const usage = await service.usage(actor);
        return jsonResult({
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
        return errorResult(getKnownErrorMessage(error));
      }
    },
  );

  server.tool(
    "storage_list",
    "List private files owned by the authenticated user. Raw object-store keys are never returned.",
    {
      prefix: z.string().max(512).optional().describe("Optional virtual-path prefix"),
      search: z.string().max(200).optional().describe("Optional path search text"),
      limit: z.number().int().min(1).max(200).optional().default(100),
    },
    async (params, extra) => {
      const actor = getStorageActor(extra, "mcp:read");
      if (typeof actor !== "string") return actor;
      try {
        const objects = await service.list(actor, {
          prefix: params.prefix?.trim() || undefined,
          search: params.search?.trim() || undefined,
          limit: params.limit,
        });
        return jsonResult(objects.map(serializeStorageObject));
      } catch (error) {
        return errorResult(getKnownErrorMessage(error));
      }
    },
  );

  server.tool(
    "storage_read",
    `Read a private user file as UTF-8 text or base64. Responses are limited to ${MAX_MCP_STORAGE_PAYLOAD_BYTES} bytes.`,
    {
      id: z.string().uuid().describe("Storage object ID from storage_list"),
      encoding: z.enum(["text", "base64"]).optional().default("text"),
    },
    async (params, extra) => {
      const actor = getStorageActor(extra, "mcp:read");
      if (typeof actor !== "string") return actor;
      try {
        const metadata = await service.get(actor, params.id);
        if (!metadata) return errorResult("file not found");
        if (metadata.sizeBytes > MAX_MCP_STORAGE_PAYLOAD_BYTES) {
          return errorResult(
            `file exceeds the ${MAX_MCP_STORAGE_PAYLOAD_BYTES}-byte MCP read limit; use the authenticated REST download endpoint`,
          );
        }

        const result = await service.read(actor, params.id);
        if (!result) return errorResult("file not found");
        if (result.bytes.byteLength > MAX_MCP_STORAGE_PAYLOAD_BYTES) {
          return errorResult(`file exceeds the ${MAX_MCP_STORAGE_PAYLOAD_BYTES}-byte MCP read limit`);
        }

        let content: string;
        if (params.encoding === "base64") {
          content = Buffer.from(result.bytes).toString("base64");
        } else {
          try {
            content = new TextDecoder("utf-8", { fatal: true }).decode(result.bytes);
          } catch {
            return errorResult("file is not valid UTF-8; request encoding=base64");
          }
        }

        return jsonResult({
          ...serializeStorageObject(result.object),
          encoding: params.encoding,
          content,
        });
      } catch (error) {
        return errorResult(getKnownErrorMessage(error));
      }
    },
  );

  server.tool(
    "storage_write",
    `Create or replace a private user file by virtual path. Provide text content or strict base64, up to ${MAX_MCP_STORAGE_PAYLOAD_BYTES} bytes.`,
    {
      path: z.string().min(1).max(512).describe("Relative POSIX virtual path"),
      content: z.string().max(MAX_MCP_STORAGE_PAYLOAD_BYTES).optional(),
      base64: z.string().max(MAX_BASE64_CHARACTERS).optional(),
      contentType: z.string().max(255).optional(),
    },
    async (params, extra) => {
      const actor = getStorageActor(extra, "mcp:write");
      if (typeof actor !== "string") return actor;
      try {
        const virtualPath = normalizeUserStoragePath(params.path);
        const bytes = getWriteBytes(params);
        const fileName = virtualPath.split("/").at(-1)!;
        const object = await service.put({
          ownerUserId: actor,
          workspaceId: null,
          virtualPath,
          fileName,
          contentType: getWriteContentType(params),
          bytes,
          kind: "file",
          metadata: { source: "mcp" },
        });
        return jsonResult(serializeStorageObject(object));
      } catch (error) {
        if (error instanceof Error && error.message.includes("payload")) {
          return errorResult(error.message);
        }
        if (error instanceof Error && error.message.includes("exactly one")) {
          return errorResult(error.message);
        }
        if (error instanceof Error && error.message.includes("base64")) {
          return errorResult(error.message);
        }
        return errorResult(getKnownErrorMessage(error));
      }
    },
  );

  server.tool(
    "storage_delete",
    "Delete a private file owned by the authenticated user.",
    { id: z.string().uuid().describe("Storage object ID from storage_list") },
    async (params, extra) => {
      const actor = getStorageActor(extra, "mcp:write");
      if (typeof actor !== "string") return actor;
      try {
        const removed = await service.remove(actor, params.id);
        return removed
          ? jsonResult({ id: params.id, deleted: true })
          : errorResult("file not found");
      } catch (error) {
        return errorResult(getKnownErrorMessage(error));
      }
    },
  );
};

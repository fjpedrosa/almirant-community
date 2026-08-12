import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  isUserWorkspaceMember,
  MAX_NOTE_POSITION,
  type LexicalDocument,
} from "@almirant/database";
import { z } from "zod";
import {
  notesService,
  NotesServiceError,
  type NotesActor,
  type NotesService,
} from "../../domains/notes/services/notes.service";
import { AUTOMATION_BOT_USER_ID } from "../../shared/services/session-token";
import {
  assertOrgScope,
  getJobIdFromExtra,
  getPermissionsFromExtra,
  getUserIdFromExtra,
  internalToolError,
  type McpToolResult,
} from "../setup";

type McpExtra = { authInfo?: { extra?: Record<string, unknown> } };
type NotesMcpService = Pick<
  NotesService,
  "searchPages" | "getPage" | "createPage" | "updatePage"
>;
type MembershipCheck = (userId: string, workspaceId: string) => Promise<boolean>;

const errorResult = (message: string): McpToolResult => ({
  content: [{ type: "text", text: `Error: ${message}` }],
  isError: true,
});

const jsonResult = (value: unknown): McpToolResult => ({
  content: [{ type: "text", text: JSON.stringify(value, null, 2) }],
});

const resultForError = (error: unknown, tool: string): McpToolResult => {
  if (error instanceof NotesServiceError && error.status < 500) {
    return errorResult(error.message);
  }
  const cause = error instanceof NotesServiceError ? error.cause ?? error : error;
  return internalToolError(cause, { domain: "notes", tool }, "Notes operation failed");
};

const authorizeActor = async (
  extra: McpExtra,
  permission: "mcp:read" | "mcp:write",
  tool: string,
  membershipCheck: MembershipCheck,
): Promise<NotesActor | McpToolResult> => {
  if (!getPermissionsFromExtra(extra).includes(permission)) {
    return errorResult("notes access denied");
  }
  const workspaceId = assertOrgScope(extra);
  if (typeof workspaceId !== "string") return workspaceId;
  const userId = getUserIdFromExtra(extra);
  if (!userId || userId === AUTOMATION_BOT_USER_ID) {
    return errorResult("notes require an authenticated human user");
  }
  if (!(await membershipCheck(userId, workspaceId))) {
    return errorResult("notes access denied");
  }

  const sessionType = extra.authInfo?.extra?.sessionType;
  const verifiedJobId = sessionType === "agent" || sessionType === "worker"
    ? getJobIdFromExtra(extra)
    : undefined;
  if (!verifiedJobId) return { workspaceId, userId };
  return {
    workspaceId,
    userId,
    actorKind: "agent",
    agentJobId: verifiedJobId,
    channel: "mcp",
    tool,
  };
};

const lexicalJsonSchema = z.record(z.string(), z.unknown());
const visibilitySchema = z.enum(["private", "workspace"]);

export const registerNotesTools = (
  server: McpServer,
  service: NotesMcpService = notesService,
  membershipCheck: MembershipCheck = isUserWorkspaceMember,
) => {
  server.tool(
    "search_notes",
    "Search notes visible to the invoking human in the active workspace.",
    {
      query: z.string().trim().min(1).max(200),
      limit: z.number().int().min(1).max(100).optional().default(20),
      offset: z.number().int().min(0).max(100_000).optional().default(0),
    },
    async (params, extra) => {
      try {
        const actor = await authorizeActor(extra, "mcp:read", "search_notes", membershipCheck);
        if ("content" in actor) return actor;
        const pages = await service.searchPages(actor, {
          query: params.query,
          limit: params.limit,
          offset: params.offset,
        });
        return jsonResult({
          notes: pages.items.map((page) => ({
            id: page.id,
            title: page.title,
            parentId: page.parentId,
            kind: page.kind,
            dailyDate: page.dailyDate,
            visibility: page.visibility,
            stateVersion: page.stateVersion,
            updatedAt: page.updatedAt,
            canEdit: page.canEdit,
            canManageShares: page.canManageShares,
            canReparent: page.canReparent,
            canArchive: page.canArchive,
            canChangeVisibility: page.canChangeVisibility,
            canRestore: page.canRestore,
          })),
          pagination: pages.pagination,
        });
      } catch (error) {
        return resultForError(error, "search_notes");
      }
    },
  );

  server.tool(
    "read_note",
    "Read one visible note as Markdown, plain text, or canonical Lexical JSON.",
    {
      id: z.string().uuid(),
      format: z.enum(["lexical", "markdown", "plain"]).optional().default("markdown"),
    },
    async (params, extra) => {
      try {
        const actor = await authorizeActor(extra, "mcp:read", "read_note", membershipCheck);
        if ("content" in actor) return actor;
        const page = await service.getPage(actor, params.id);
        const format = params.format ?? "markdown";
        const content = format === "lexical"
          ? page.lexicalJson
          : format === "plain"
            ? page.plaintextProjection
            : page.markdownProjection;
        return jsonResult({
          id: page.id,
          title: page.title,
          stateVersion: page.stateVersion,
          canEdit: page.canEdit,
          canManageShares: page.canManageShares,
          canReparent: page.canReparent,
          canArchive: page.canArchive,
          canChangeVisibility: page.canChangeVisibility,
          canRestore: page.canRestore,
          format,
          content,
        });
      } catch (error) {
        return resultForError(error, "read_note");
      }
    },
  );

  server.tool(
    "create_note",
    "Create a regular note owned by the invoking human in the active workspace.",
    {
      title: z.string().max(500).optional(),
      parentId: z.string().uuid().nullable().optional(),
      visibility: visibilitySchema.optional(),
      position: z.number().int().min(0).max(MAX_NOTE_POSITION).optional(),
      lexicalJson: lexicalJsonSchema.optional(),
    },
    async (params, extra) => {
      try {
        const actor = await authorizeActor(extra, "mcp:write", "create_note", membershipCheck);
        if ("content" in actor) return actor;
        const created = await service.createPage(actor, {
          title: params.title,
          parentId: params.parentId,
          visibility: params.visibility,
          position: params.position,
          lexicalJson: params.lexicalJson as LexicalDocument | undefined,
        });
        return jsonResult(created);
      } catch (error) {
        return resultForError(error, "create_note");
      }
    },
  );

  server.tool(
    "update_note",
    "CAS-update a visible note. expectedVersion is required; stale writes fail without overwriting newer content.",
    {
      id: z.string().uuid(),
      expectedVersion: z.number().int().min(1),
      title: z.string().max(500).optional(),
      parentId: z.string().uuid().nullable().optional(),
      visibility: visibilitySchema.optional(),
      position: z.number().int().min(0).max(MAX_NOTE_POSITION).optional(),
      lexicalJson: lexicalJsonSchema.optional(),
    },
    async (params, extra) => {
      try {
        const actor = await authorizeActor(extra, "mcp:write", "update_note", membershipCheck);
        if ("content" in actor) return actor;
        const updated = await service.updatePage(actor, params.id, {
          expectedVersion: params.expectedVersion,
          title: params.title,
          parentId: params.parentId,
          visibility: params.visibility,
          position: params.position,
          lexicalJson: params.lexicalJson as LexicalDocument | undefined,
        });
        // Writes acknowledge only the stable identity/version metadata. Full
        // content remains behind read_note + mcp:read to prevent write-only
        // credentials from exfiltrating note data.
        return jsonResult({ id: updated.id, stateVersion: updated.stateVersion, updatedAt: updated.updatedAt });
      } catch (error) {
        return resultForError(error, "update_note");
      }
    },
  );
};

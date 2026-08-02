import { Elysia, t } from "elysia";
import { env, logger } from "@almirant/config";
import {
  archiveAgentMcpServer,
  archiveAgentPlugin,
  createAgentMcpServer,
  createAgentPlugin,
  getAgentMcpServerById,
  getAgentPluginById,
  listAgentMcpServersByWorkspace,
  listAgentPluginsByWorkspace,
  updateAgentMcpServer,
  updateAgentPlugin,
  decryptCredentials,
  encryptCredentials,
} from "@almirant/database";
import { isValidRunnerMcpServerName } from "@almirant/shared";
import { sessionContextTypes } from "../../../shared/middleware/session-context-types.plugin";
import { validateOutboundHttpUrl } from "../../../shared/services/outbound-http-policy";
import { successResponse, errorResponse, internalErrorResponse, notFoundResponse } from "../../../shared/services/response";
import {
  MCP_CONNECTOR_TEMPLATES,
  MCP_CONNECTOR_TEMPLATE_KEYS,
  buildMcpConnectorCredentials,
  getMcpConnectorTemplate,
  normalizeMcpConnectorConfiguration,
  type McpConnectorTemplateKey,
} from "../services/mcp-connector-templates";
import {
  buildMcpServerHeaders,
  testMcpConnection,
  type McpConnectionTestResult,
} from "../services/mcp-connection-service";

const MCP_AUTH_TYPES = ["none", "bearer", "custom_header"] as const;
const MCP_AUTH_HEADER_RE = /^[!#$%&'*+.^_`|~0-9A-Za-z-]{1,128}$/;
const PLUGIN_SLUG_RE = /^[a-z0-9][a-z0-9_-]{0,63}$/;

type McpAuthType = (typeof MCP_AUTH_TYPES)[number];

const slugify = (value: string): string =>
  value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);

const requireEncryptionKey = (): string => {
  if (!env.ENCRYPTION_KEY) {
    throw new Error("ENCRYPTION_KEY is not configured. Cannot store MCP secrets.");
  }
  return env.ENCRYPTION_KEY;
};

const normalizeMcpSlug = (body: { slug?: string; name?: string }): string => {
  const slug = slugify(body.slug || body.name || "");
  if (!slug || !isValidRunnerMcpServerName(slug)) {
    throw new Error("MCP slug must be 1-64 letters, numbers, _ or -, and cannot use a platform-reserved name");
  }
  return slug;
};

const normalizePluginSlug = (body: { slug?: string; name?: string }): string => {
  const slug = slugify(body.slug || body.name || "");
  if (!PLUGIN_SLUG_RE.test(slug)) {
    throw new Error("Plugin slug must be 1-64 lowercase letters, numbers, _ or -");
  }
  return slug;
};

const normalizeUrl = (rawUrl: string): string => {
  const url = rawUrl.trim();
  try {
    const parsed = new URL(url);
    if (parsed.username || parsed.password) {
      throw new Error("MCP URL cannot contain embedded credentials");
    }
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
      throw new Error("MCP URL must be http(s)");
    }
    return parsed.toString();
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("MCP URL")) throw error;
    throw new Error("MCP URL must be a valid http(s) URL");
  }
};

const normalizeHeaderName = (authType: McpAuthType, headerName?: string | null): string | null => {
  if (authType === "bearer") return "Authorization";
  if (authType === "none") return null;

  const normalized = headerName?.trim() || "";
  if (!MCP_AUTH_HEADER_RE.test(normalized)) {
    throw new Error("Custom auth header name is invalid");
  }
  return normalized;
};

const buildCredentialsPayload = (
  authType: McpAuthType,
  headerName: string | null,
  secret?: string | null,
): Record<string, string> | null | undefined => {
  const trimmedSecret = secret?.trim();

  if (authType === "none") return null;
  if (!trimmedSecret) return undefined;
  if (/[\r\n]/.test(trimmedSecret)) {
    throw new Error("MCP secret cannot contain line breaks");
  }

  if (authType === "bearer") {
    return {
      Authorization: trimmedSecret.toLowerCase().startsWith("bearer ")
        ? trimmedSecret
        : `Bearer ${trimmedSecret}`,
    };
  }

  if (!headerName) {
    throw new Error("Custom auth header name is required");
  }
  return { [headerName]: trimmedSecret };
};

const encryptPayload = (payload: Record<string, string>) =>
  encryptCredentials(payload, requireEncryptionKey());

const getUserId = (ctx: unknown): string | null => {
  const user = (ctx as Record<string, unknown>).user as { id?: string } | null | undefined;
  return user?.id ?? null;
};

const createMcpBodySchema = t.Object({
  name: t.String({ minLength: 1, maxLength: 255 }),
  slug: t.Optional(t.String({ maxLength: 64 })),
  description: t.Optional(t.Nullable(t.String({ maxLength: 2000 }))),
  url: t.String({ minLength: 1, maxLength: 2048 }),
  authType: t.Optional(t.Union(MCP_AUTH_TYPES.map((value) => t.Literal(value)))),
  authHeaderName: t.Optional(t.Nullable(t.String({ maxLength: 128 }))),
  secret: t.Optional(t.Nullable(t.String({ maxLength: 10000 }))),
});

const updateMcpBodySchema = t.Object({
  name: t.Optional(t.String({ minLength: 1, maxLength: 255 })),
  slug: t.Optional(t.String({ maxLength: 64 })),
  description: t.Optional(t.Nullable(t.String({ maxLength: 2000 }))),
  url: t.Optional(t.String({ minLength: 1, maxLength: 2048 })),
  authType: t.Optional(t.Union(MCP_AUTH_TYPES.map((value) => t.Literal(value)))),
  authHeaderName: t.Optional(t.Nullable(t.String({ maxLength: 128 }))),
  secret: t.Optional(t.Nullable(t.String({ maxLength: 10000 }))),
  clearSecret: t.Optional(t.Boolean()),
  configuration: t.Optional(t.Record(t.String({ maxLength: 64 }), t.Unknown())),
});

const templateKeySchema = t.Union(
  MCP_CONNECTOR_TEMPLATE_KEYS.map((key) => t.Literal(key)),
);

const createMcpFromTemplateBodySchema = t.Object({
  templateKey: templateKeySchema,
  name: t.Optional(t.String({ minLength: 1, maxLength: 255 })),
  slug: t.Optional(t.String({ maxLength: 64 })),
  description: t.Optional(t.Nullable(t.String({ maxLength: 2000 }))),
  secret: t.Optional(t.Nullable(t.String({ maxLength: 10000 }))),
  configuration: t.Optional(t.Record(t.String({ maxLength: 64 }), t.Unknown())),
});

const testMcpBodySchema = t.Object({
  templateKey: t.Optional(templateKeySchema),
  url: t.Optional(t.String({ minLength: 1, maxLength: 2048 })),
  authType: t.Optional(t.Union(MCP_AUTH_TYPES.map((value) => t.Literal(value)))),
  authHeaderName: t.Optional(t.Nullable(t.String({ maxLength: 128 }))),
  secret: t.Optional(t.Nullable(t.String({ maxLength: 10000 }))),
  configuration: t.Optional(t.Record(t.String({ maxLength: 64 }), t.Unknown())),
});

const pluginBodySchema = t.Object({
  name: t.String({ minLength: 1, maxLength: 255 }),
  slug: t.Optional(t.String({ maxLength: 64 })),
  description: t.Optional(t.Nullable(t.String({ maxLength: 2000 }))),
  instructions: t.String({ minLength: 1, maxLength: 50000 }),
  enabled: t.Optional(t.Boolean()),
});

const updatePluginBodySchema = t.Object({
  name: t.Optional(t.String({ minLength: 1, maxLength: 255 })),
  slug: t.Optional(t.String({ maxLength: 64 })),
  description: t.Optional(t.Nullable(t.String({ maxLength: 2000 }))),
  instructions: t.Optional(t.String({ minLength: 1, maxLength: 50000 })),
  enabled: t.Optional(t.Boolean()),
});

export interface AgentToolingRouteDependencies {
  validateOutboundHttpUrl: typeof validateOutboundHttpUrl;
  buildMcpServerHeaders: typeof buildMcpServerHeaders;
  testMcpConnection: (
    input: { url: string; headers: Record<string, string> },
  ) => Promise<McpConnectionTestResult>;
}

const defaultAgentToolingRouteDependencies: AgentToolingRouteDependencies = {
  validateOutboundHttpUrl,
  buildMcpServerHeaders,
  testMcpConnection,
};

export const createAgentToolingRoutes = (
  dependencies: AgentToolingRouteDependencies = defaultAgentToolingRouteDependencies,
) => new Elysia({ prefix: "/scheduled-agents" })
  .use(sessionContextTypes)

  .get("/mcp-servers", async ({ activeWorkspace, user, set }) => {
    try {
      const workspaceId = activeWorkspace!.id;
      return successResponse(await listAgentMcpServersByWorkspace(workspaceId, user!.id));
    } catch (error) {
      logger.error({ error }, "Failed to list agent MCP servers");
      set.status = 500;
      return errorResponse("Failed to list MCP servers", 500);
    }
  })

  .get("/mcp-servers/templates", () =>
    successResponse(
      MCP_CONNECTOR_TEMPLATES.map((template) => ({
        ...template,
        defaultConfiguration: { ...template.defaultConfiguration },
      })),
    ),
  )

  .post(
    "/mcp-servers/from-template",
    async (ctx) => {
      const { body, activeWorkspace, set } = ctx;
      try {
        const workspaceId = activeWorkspace!.id;
        const ownerUserId = getUserId(ctx);
        if (!ownerUserId) throw new Error("Authenticated user is required");
        const templateKey = body.templateKey as McpConnectorTemplateKey;
        const template = getMcpConnectorTemplate(templateKey);
        const configuration = normalizeMcpConnectorConfiguration(
          templateKey,
          body.configuration,
        );
        const credentials = buildMcpConnectorCredentials(templateKey, body.secret);
        if (credentials) {
          dependencies.buildMcpServerHeaders({
            templateKey,
            configuration,
            credentials,
          });
        }
        const encrypted = credentials ? encryptPayload(credentials) : null;

        const created = await createAgentMcpServer({
          workspaceId,
          projectId: null,
          name: body.name?.trim() || template.name,
          slug: normalizeMcpSlug({
            slug: body.slug ?? template.runnerServerName,
          }),
          description: body.description?.trim() || template.description,
          url: template.url,
          transport: "remote",
          visibility: "user",
          ownerUserId,
          authType: template.authType,
          authHeaderName: template.authHeaderName,
          templateKey,
          configuration,
          encryptedCredentials: encrypted?.encryptedCredentials ?? null,
          credentialsIv: encrypted?.credentialsIv ?? null,
          credentialsAuthTag: encrypted?.credentialsAuthTag ?? null,
          createdByUserId: getUserId(ctx),
        });
        set.status = 201;
        return successResponse(created);
      } catch (error) {
        set.status = 500;
        return internalErrorResponse(
          error,
          { route: "/scheduled-agents/mcp-servers/from-template" },
          "Failed to create MCP connector",
        );
      }
    },
    { body: createMcpFromTemplateBodySchema },
  )

  .post(
    "/mcp-servers/test",
    async ({ body, set }) => {
      try {
        let url: string;
        let headers: Record<string, string>;
        if (body.templateKey) {
          const templateKey = body.templateKey as McpConnectorTemplateKey;
          const template = getMcpConnectorTemplate(templateKey);
          const configuration = normalizeMcpConnectorConfiguration(
            templateKey,
            body.configuration,
          );
          const credentials = buildMcpConnectorCredentials(templateKey, body.secret);
          url = template.url;
          headers = dependencies.buildMcpServerHeaders({
            templateKey,
            configuration,
            credentials,
          });
        } else {
          if (!body.url) {
            set.status = 400;
            return errorResponse("URL is required for a custom MCP connection test", 400);
          }
          const authType = (body.authType ?? "none") as McpAuthType;
          const authHeaderName = normalizeHeaderName(authType, body.authHeaderName);
          const credentials = buildCredentialsPayload(
            authType,
            authHeaderName,
            body.secret,
          );
          if (authType !== "none" && credentials === undefined) {
            set.status = 400;
            return errorResponse("Secret is required for authenticated MCP servers", 400);
          }
          url = normalizeUrl(body.url);
          headers = dependencies.buildMcpServerHeaders({
            credentials: credentials ?? null,
          });
        }

        return successResponse(await dependencies.testMcpConnection({ url, headers }));
      } catch (error) {
        set.status = 500;
        return internalErrorResponse(
          error,
          { route: "/scheduled-agents/mcp-servers/test" },
          "Failed to test MCP connection",
        );
      }
    },
    { body: testMcpBodySchema },
  )

  .post(
    "/mcp-servers",
    async (ctx) => {
      const { body, activeWorkspace, set } = ctx;
      try {
        const workspaceId = activeWorkspace!.id;
        const ownerUserId = getUserId(ctx);
        if (!ownerUserId) throw new Error("Authenticated user is required");
        const authType = (body.authType ?? "none") as McpAuthType;
        const authHeaderName = normalizeHeaderName(authType, body.authHeaderName);
        const credentialsPayload = buildCredentialsPayload(authType, authHeaderName, body.secret);

        if (authType !== "none" && credentialsPayload === undefined) {
          set.status = 400;
          return errorResponse("Secret is required for authenticated MCP servers", 400);
        }

        dependencies.buildMcpServerHeaders({
          credentials: credentialsPayload ?? null,
        });

        const encrypted = credentialsPayload ? encryptPayload(credentialsPayload) : null;
        const created = await createAgentMcpServer({
          workspaceId,
          projectId: null,
          name: body.name.trim(),
          slug: normalizeMcpSlug(body),
          description: body.description?.trim() || null,
          url: (
            await dependencies.validateOutboundHttpUrl(normalizeUrl(body.url))
          ).url.toString(),
          transport: "remote",
          visibility: "user",
          ownerUserId,
          authType,
          authHeaderName,
          templateKey: null,
          configuration: {},
          encryptedCredentials: encrypted?.encryptedCredentials ?? null,
          credentialsIv: encrypted?.credentialsIv ?? null,
          credentialsAuthTag: encrypted?.credentialsAuthTag ?? null,
          createdByUserId: getUserId(ctx),
        });
        set.status = 201;
        return successResponse(created);
      } catch (error) {
        set.status = 500;
        return internalErrorResponse(
          error,
          { route: "/scheduled-agents/mcp-servers" },
          "Failed to create MCP server",
        );
      }
    },
    { body: createMcpBodySchema },
  )

  .post(
    "/mcp-servers/:id/test",
    async ({ params, activeWorkspace, user, set }) => {
      try {
        const workspaceId = activeWorkspace!.id;
        const existing = await getAgentMcpServerById(params.id, workspaceId, user!.id);
        if (!existing) {
          set.status = 404;
          return notFoundResponse("MCP server");
        }

        const credentials = existing.encryptedCredentials
          ? decryptCredentials(existing, requireEncryptionKey())
          : null;
        const headers = dependencies.buildMcpServerHeaders({
          templateKey: existing.templateKey,
          configuration: existing.configuration,
          credentials,
        });
        return successResponse(
          await dependencies.testMcpConnection({
            url: existing.url,
            headers,
          }),
        );
      } catch (error) {
        logger.warn({ error }, "Failed to test saved MCP connection");
        set.status = 500;
        return errorResponse("Failed to test MCP connection", 500);
      }
    },
    { params: t.Object({ id: t.String() }), body: t.Optional(t.Object({})) },
  )

  .patch(
    "/mcp-servers/:id",
    async ({ params, body, activeWorkspace, user, set }) => {
      try {
        const workspaceId = activeWorkspace!.id;
        const existing = await getAgentMcpServerById(params.id, workspaceId, user!.id);
        if (!existing) {
          set.status = 404;
          return notFoundResponse("MCP server");
        }

        if (
          existing.templateKey &&
          (body.url !== undefined ||
            body.authType !== undefined ||
            body.authHeaderName !== undefined)
        ) {
          throw new Error("Template MCP endpoint and authentication fields are immutable");
        }

        let normalizedConfiguration: Record<string, unknown> | undefined;
        if (body.configuration !== undefined) {
          if (!existing.templateKey) {
            if (Object.keys(body.configuration).length > 0) {
              throw new Error("Custom MCP servers do not accept template configuration");
            }
            normalizedConfiguration = {};
          } else {
            normalizedConfiguration = normalizeMcpConnectorConfiguration(
              existing.templateKey as McpConnectorTemplateKey,
              body.configuration,
            );
          }
        }

        if (
          body.clearSecret &&
          existing.templateKey &&
          getMcpConnectorTemplate(existing.templateKey).secretRequired
        ) {
          throw new Error(`${existing.name} credentials cannot be cleared`);
        }

        const nextAuthType = (body.authType ?? existing.authType) as McpAuthType;
        const nextHeaderName = normalizeHeaderName(
          nextAuthType,
          body.authHeaderName !== undefined ? body.authHeaderName : existing.authHeaderName,
        );
        if (body.clearSecret && !existing.templateKey && nextAuthType !== "none") {
          throw new Error(
            "Set authType to none when clearing a custom MCP server secret",
          );
        }
        const credentialsPayload = body.clearSecret
          ? null
          : buildCredentialsPayload(nextAuthType, nextHeaderName, body.secret);
        const authShapeChanged =
          nextAuthType !== existing.authType ||
          nextHeaderName !== existing.authHeaderName;
        if (
          !existing.templateKey &&
          nextAuthType !== "none" &&
          credentialsPayload === undefined &&
          (!existing.encryptedCredentials || authShapeChanged)
        ) {
          throw new Error("A new secret is required when changing MCP authentication");
        }
        if (credentialsPayload) {
          dependencies.buildMcpServerHeaders({ credentials: credentialsPayload });
        }
        const encrypted = credentialsPayload ? encryptPayload(credentialsPayload) : undefined;

        const normalizedUpdatedUrl = body.url !== undefined
          ? (
              await dependencies.validateOutboundHttpUrl(normalizeUrl(body.url))
            ).url.toString()
          : undefined;

        const updateData: Record<string, unknown> = {
          ...(body.name !== undefined ? { name: body.name.trim() } : {}),
          ...(body.slug !== undefined ? { slug: normalizeMcpSlug({ slug: body.slug }) } : {}),
          ...(body.description !== undefined ? { description: body.description?.trim() || null } : {}),
          ...(normalizedUpdatedUrl !== undefined ? { url: normalizedUpdatedUrl } : {}),
          ...(body.authType !== undefined ? { authType: nextAuthType } : {}),
          ...(body.authType !== undefined || body.authHeaderName !== undefined
            ? { authHeaderName: nextHeaderName }
            : {}),
          ...(normalizedConfiguration !== undefined
            ? { configuration: normalizedConfiguration }
            : {}),
        };

        if (credentialsPayload === null || nextAuthType === "none") {
          updateData.encryptedCredentials = null;
          updateData.credentialsIv = null;
          updateData.credentialsAuthTag = null;
        } else if (encrypted) {
          updateData.encryptedCredentials = encrypted.encryptedCredentials;
          updateData.credentialsIv = encrypted.credentialsIv;
          updateData.credentialsAuthTag = encrypted.credentialsAuthTag;
        }

        const updated = await updateAgentMcpServer(
          params.id,
          workspaceId,
          user!.id,
          updateData,
        );
        if (!updated) {
          set.status = 404;
          return notFoundResponse("MCP server");
        }
        return successResponse(updated);
      } catch (error) {
        set.status = 500;
        return internalErrorResponse(
          error,
          { route: "/scheduled-agents/mcp-servers/:id", mcpServerId: params.id },
          "Failed to update MCP server",
        );
      }
    },
    { params: t.Object({ id: t.String() }), body: updateMcpBodySchema },
  )

  .delete(
    "/mcp-servers/:id",
    async ({ params, activeWorkspace, user, set }) => {
      const workspaceId = activeWorkspace!.id;
      const deleted = await archiveAgentMcpServer(params.id, workspaceId, user!.id);
      if (!deleted) {
        set.status = 404;
        return notFoundResponse("MCP server");
      }
      return successResponse({ deleted: true });
    },
    { params: t.Object({ id: t.String() }) },
  )

  .get("/plugins", async ({ activeWorkspace, user, set }) => {
    try {
      const workspaceId = activeWorkspace!.id;
      return successResponse(await listAgentPluginsByWorkspace(workspaceId, user!.id));
    } catch (error) {
      logger.error({ error }, "Failed to list agent plugins");
      set.status = 500;
      return errorResponse("Failed to list plugins", 500);
    }
  })

  .post(
    "/plugins",
    async (ctx) => {
      const { body, activeWorkspace, set } = ctx;
      try {
        const workspaceId = activeWorkspace!.id;
        const ownerUserId = getUserId(ctx);
        if (!ownerUserId) throw new Error("Authenticated user is required");
        const created = await createAgentPlugin({
          workspaceId,
          name: body.name.trim(),
          slug: normalizePluginSlug(body),
          description: body.description?.trim() || null,
          instructions: body.instructions.trim(),
          ownerUserId,
          visibility: "user",
          enabled: body.enabled ?? true,
          createdByUserId: getUserId(ctx),
        });
        set.status = 201;
        return successResponse(created);
      } catch (error) {
        set.status = 500;
        return internalErrorResponse(
          error,
          { route: "/scheduled-agents/plugins" },
          "Failed to create plugin",
        );
      }
    },
    { body: pluginBodySchema },
  )

  .patch(
    "/plugins/:id",
    async ({ params, body, activeWorkspace, user, set }) => {
      try {
        const workspaceId = activeWorkspace!.id;
        const existing = await getAgentPluginById(params.id, workspaceId, user!.id);
        if (!existing) {
          set.status = 404;
          return notFoundResponse("Plugin");
        }

        const updated = await updateAgentPlugin(params.id, workspaceId, user!.id, {
          ...(body.name !== undefined ? { name: body.name.trim() } : {}),
          ...(body.slug !== undefined ? { slug: normalizePluginSlug({ slug: body.slug }) } : {}),
          ...(body.description !== undefined ? { description: body.description?.trim() || null } : {}),
          ...(body.instructions !== undefined ? { instructions: body.instructions.trim() } : {}),
          ...(body.enabled !== undefined ? { enabled: body.enabled } : {}),
        });
        if (!updated) {
          set.status = 404;
          return notFoundResponse("Plugin");
        }
        return successResponse(updated);
      } catch (error) {
        set.status = 500;
        return internalErrorResponse(
          error,
          { route: "/scheduled-agents/plugins/:id", pluginId: params.id },
          "Failed to update plugin",
        );
      }
    },
    { params: t.Object({ id: t.String() }), body: updatePluginBodySchema },
  )

  .delete(
    "/plugins/:id",
    async ({ params, activeWorkspace, user, set }) => {
      const workspaceId = activeWorkspace!.id;
      const deleted = await archiveAgentPlugin(params.id, workspaceId, user!.id);
      if (!deleted) {
        set.status = 404;
        return notFoundResponse("Plugin");
      }
      return successResponse({ deleted: true });
    },
    { params: t.Object({ id: t.String() }) },
  );

export const agentToolingRoutes = createAgentToolingRoutes();

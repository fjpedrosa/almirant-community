import { Elysia, t } from "elysia";
import { logger } from "@almirant/config";
import type { AgentPluginDb, PluginMarketplaceDb } from "@almirant/database";
import { sessionContextTypes } from "../../../shared/middleware/session-context-types.plugin";
import { errorResponse, successResponse } from "../../../shared/services/response";
import {
  AgentPluginCatalogError,
  MAX_PRIVATE_PLUGIN_BUNDLE_BYTES,
  OFFICIAL_CLAUDE_MARKETPLACE_SLUG,
  type AgentPluginCatalogService,
} from "../services/agent-plugin-catalog-service";
import { agentPluginCatalogService } from "../services/agent-plugin-catalog-runtime";
import { MarketplaceCatalogLoadError } from "../services/plugin-marketplace-loader";

const serializeMarketplace = (marketplace: PluginMarketplaceDb) => ({
  id: marketplace.id,
  name: marketplace.name,
  slug: marketplace.slug,
  provider: marketplace.provider,
  source: marketplace.source,
  sourceType: marketplace.sourceType,
  catalog: marketplace.catalog,
  enabled: marketplace.enabled,
  isBuiltIn: marketplace.slug === OFFICIAL_CLAUDE_MARKETPLACE_SLUG,
  lastSyncedAt: marketplace.lastSyncedAt?.toISOString() ?? null,
  createdAt: marketplace.createdAt.toISOString(),
  updatedAt: marketplace.updatedAt.toISOString(),
});

const serializePackagePlugin = (plugin: AgentPluginDb) => ({
  id: plugin.id,
  name: plugin.name,
  slug: plugin.slug,
  description: plugin.description,
  provider: plugin.provider,
  sourceType: plugin.sourceType,
  marketplaceId: plugin.marketplaceId,
  externalId: plugin.externalId,
  version: plugin.version,
  checksumSha256: plugin.checksumSha256,
  manifest: plugin.manifest,
  enabled: plugin.enabled,
  createdAt: plugin.createdAt.toISOString(),
  updatedAt: plugin.updatedAt.toISOString(),
});

const readErrorCode = (error: unknown): string | undefined => {
  if (!error || typeof error !== "object" || !("code" in error)) return undefined;
  return typeof error.code === "string" ? error.code : undefined;
};

const handlePluginCatalogError = (
  error: unknown,
  set: { status?: number | string },
  operation: string,
) => {
  if (error instanceof AgentPluginCatalogError) {
    if (
      error.code === "PLUGIN_MARKETPLACE_NOT_FOUND" ||
      error.code === "PLUGIN_ENTRY_NOT_FOUND"
    ) {
      set.status = 404;
      return errorResponse(error.message, 404, error.code);
    }
    set.status = 400;
    return errorResponse(error.message, 400, error.code);
  }
  if (error instanceof MarketplaceCatalogLoadError) {
    set.status = 400;
    return errorResponse(error.message, 400, error.code);
  }

  const code = readErrorCode(error);
  if (code === "USER_STORAGE_QUOTA_EXCEEDED") {
    set.status = 413;
    return errorResponse("User storage quota exceeded", 413, code);
  }
  if (code === "USER_STORAGE_UNAVAILABLE") {
    set.status = 503;
    return errorResponse("Private user storage is not configured", 503, code);
  }
  if (code === "23505") {
    set.status = 409;
    return errorResponse("Plugin marketplace or package already exists", 409);
  }

  logger.error({ error, operation }, "Plugin catalog operation failed");
  set.status = 500;
  return errorResponse("Plugin catalog operation failed", 500);
};

const addMarketplaceBodySchema = t.Object(
  {
    source: t.String({ minLength: 1, maxLength: 2_048 }),
    name: t.Optional(t.Nullable(t.String({ minLength: 1, maxLength: 255 }))),
  },
  // Unknown fields are ignored by the handler; ownership always comes from session context.
  { additionalProperties: true },
);

const uploadBundleBodySchema = t.Object({
  file: t.File({ maxSize: MAX_PRIVATE_PLUGIN_BUNDLE_BYTES }),
  name: t.Optional(t.String({ minLength: 1, maxLength: 255 })),
  description: t.Optional(t.String({ maxLength: 2_000 })),
});

export const createPluginMarketplacesRoutes = (
  service: AgentPluginCatalogService = agentPluginCatalogService,
) =>
  new Elysia({ prefix: "/scheduled-agents" })
    .use(sessionContextTypes)
    .get("/plugin-marketplaces", async ({ activeWorkspace, user, set }) => {
      try {
        const rows = await service.listMarketplaces(activeWorkspace!.id, user!.id);
        return successResponse(rows.map(serializeMarketplace));
      } catch (error) {
        return handlePluginCatalogError(error, set, "list marketplaces");
      }
    })
    .post(
      "/plugin-marketplaces",
      async ({ body, activeWorkspace, user, set }) => {
        try {
          const created = await service.addMarketplace({
            workspaceId: activeWorkspace!.id,
            ownerUserId: user!.id,
            source: body.source,
            name: body.name,
          });
          set.status = 201;
          return successResponse(serializeMarketplace(created));
        } catch (error) {
          return handlePluginCatalogError(error, set, "add marketplace");
        }
      },
      { body: addMarketplaceBodySchema },
    )
    .post(
      "/plugin-marketplaces/:id/sync",
      async ({ params, activeWorkspace, user, set }) => {
        try {
          const updated = await service.syncMarketplace(
            activeWorkspace!.id,
            user!.id,
            params.id,
          );
          return successResponse(serializeMarketplace(updated));
        } catch (error) {
          return handlePluginCatalogError(error, set, "sync marketplace");
        }
      },
      { params: t.Object({ id: t.String({ format: "uuid" }) }) },
    )
    .delete(
      "/plugin-marketplaces/:id",
      async ({ params, activeWorkspace, user, set }) => {
        try {
          const deleted = await service.removeMarketplace(
            activeWorkspace!.id,
            user!.id,
            params.id,
          );
          return successResponse({ deleted });
        } catch (error) {
          return handlePluginCatalogError(error, set, "remove marketplace");
        }
      },
      { params: t.Object({ id: t.String({ format: "uuid" }) }) },
    )
    .post(
      "/plugin-marketplaces/:id/plugins/:externalId/install",
      async ({ params, activeWorkspace, user, set }) => {
        try {
          const installed = await service.installMarketplacePlugin({
            workspaceId: activeWorkspace!.id,
            ownerUserId: user!.id,
            marketplaceId: params.id,
            externalId: params.externalId,
          });
          set.status = 201;
          return successResponse(serializePackagePlugin(installed));
        } catch (error) {
          return handlePluginCatalogError(error, set, "install marketplace plugin");
        }
      },
      {
        params: t.Object({
          id: t.String({ format: "uuid" }),
          externalId: t.String({ minLength: 1, maxLength: 128 }),
        }),
      },
    )
    .get("/plugin-packages", async ({ activeWorkspace, user, set }) => {
      try {
        const rows = await service.listOwnedPackagePlugins(
          activeWorkspace!.id,
          user!.id,
        );
        return successResponse(rows.map(serializePackagePlugin));
      } catch (error) {
        return handlePluginCatalogError(error, set, "list plugin packages");
      }
    })
    .post(
      "/plugin-packages/upload",
      async ({ body, activeWorkspace, user, set }) => {
        try {
          if (body.file.size > MAX_PRIVATE_PLUGIN_BUNDLE_BYTES) {
            set.status = 413;
            return errorResponse("Private plugin ZIP cannot exceed 25 MiB", 413);
          }
          const created = await service.uploadPrivateBundle({
            workspaceId: activeWorkspace!.id,
            ownerUserId: user!.id,
            fileName: body.file.name,
            name: body.name,
            description: body.description,
            bytes: new Uint8Array(await body.file.arrayBuffer()),
          });
          set.status = 201;
          return successResponse(serializePackagePlugin(created));
        } catch (error) {
          return handlePluginCatalogError(error, set, "upload private plugin bundle");
        }
      },
      { body: uploadBundleBodySchema },
    );

export const pluginMarketplacesRoutes = createPluginMarketplacesRoutes();

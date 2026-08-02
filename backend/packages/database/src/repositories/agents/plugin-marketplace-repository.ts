import { and, desc, eq, inArray, isNull, or, sql } from "drizzle-orm";
import { db } from "../../client";
import {
  agentPlugins,
  pluginMarketplaces,
  type AgentPluginDb,
  type AgentPluginSourceType,
  type NewAgentPlugin,
  type NewPluginMarketplace,
  type PluginMarketplaceDb,
} from "../../schema";

export const ensurePluginMarketplace = async (
  input: NewPluginMarketplace,
): Promise<PluginMarketplaceDb> =>
  db.transaction(async (tx) => {
    const [created] = await tx
      .insert(pluginMarketplaces)
      .values(input)
      .onConflictDoNothing({
        target: [
          pluginMarketplaces.slug,
          pluginMarketplaces.workspaceId,
          pluginMarketplaces.ownerUserId,
        ],
      })
      .returning();
    if (created) return created;

    const [existing] = await tx
      .select()
      .from(pluginMarketplaces)
      .where(
        and(
          eq(pluginMarketplaces.workspaceId, input.workspaceId),
          eq(pluginMarketplaces.slug, input.slug),
          input.ownerUserId
            ? eq(pluginMarketplaces.ownerUserId, input.ownerUserId)
            : isNull(pluginMarketplaces.ownerUserId),
        ),
      )
      .limit(1);
    if (!existing) throw new Error("Failed to ensure plugin marketplace");

    const sourceChanged =
      existing.source !== input.source || existing.provider !== input.provider;
    const [updated] = await tx
      .update(pluginMarketplaces)
      .set({
        name: input.name,
        provider: input.provider,
        source: input.source,
        sourceType: input.sourceType,
        enabled: true,
        ...(sourceChanged ? { catalog: null, lastSyncedAt: null } : {}),
        updatedAt: new Date(),
      })
      .where(eq(pluginMarketplaces.id, existing.id))
      .returning();
    if (!updated) throw new Error("Failed to ensure plugin marketplace");
    return updated;
  });

export const listPluginMarketplacesByWorkspace = async (
  workspaceId: string,
  ownerUserId: string,
): Promise<PluginMarketplaceDb[]> =>
  db
    .select()
    .from(pluginMarketplaces)
    .where(
      and(
        eq(pluginMarketplaces.workspaceId, workspaceId),
        or(
          isNull(pluginMarketplaces.ownerUserId),
          eq(pluginMarketplaces.ownerUserId, ownerUserId),
        ),
      ),
    )
    .orderBy(pluginMarketplaces.createdAt);

export const getPluginMarketplaceById = async (
  id: string,
  workspaceId: string,
  ownerUserId: string | null,
): Promise<PluginMarketplaceDb | undefined> => {
  const [marketplace] = await db
    .select()
    .from(pluginMarketplaces)
    .where(
      and(
        eq(pluginMarketplaces.id, id),
        eq(pluginMarketplaces.workspaceId, workspaceId),
        or(
          isNull(pluginMarketplaces.ownerUserId),
          ownerUserId
            ? eq(pluginMarketplaces.ownerUserId, ownerUserId)
            : undefined,
        ),
      ),
    )
    .limit(1);
  return marketplace;
};

export const createPluginMarketplace = async (
  input: NewPluginMarketplace,
): Promise<PluginMarketplaceDb> => {
  const [created] = await db
    .insert(pluginMarketplaces)
    .values(input)
    .returning();
  if (!created) throw new Error("Failed to create plugin marketplace");
  return created;
};

export const updatePluginMarketplaceCatalog = async (
  id: string,
  workspaceId: string,
  ownerUserId: string,
  input: {
    source: string;
    catalog: Record<string, unknown>;
    lastSyncedAt: Date;
  },
): Promise<PluginMarketplaceDb | undefined> => {
  const [updated] = await db
    .update(pluginMarketplaces)
    .set({ ...input, updatedAt: new Date() })
    .where(
      and(
        eq(pluginMarketplaces.id, id),
        eq(pluginMarketplaces.workspaceId, workspaceId),
        or(
          isNull(pluginMarketplaces.ownerUserId),
          eq(pluginMarketplaces.ownerUserId, ownerUserId),
        ),
      ),
    )
    .returning();
  return updated;
};

export const deletePluginMarketplace = async (
  id: string,
  workspaceId: string,
  ownerUserId: string,
): Promise<boolean> => {
  const [deleted] = await db
    .delete(pluginMarketplaces)
    .where(
      and(
        eq(pluginMarketplaces.id, id),
        eq(pluginMarketplaces.workspaceId, workspaceId),
        eq(pluginMarketplaces.ownerUserId, ownerUserId),
      ),
    )
    .returning({ id: pluginMarketplaces.id });
  return Boolean(deleted);
};

export const findOwnedAgentPluginVersion = async (input: {
  workspaceId: string;
  ownerUserId: string;
  checksumSha256: string;
  sourceType?: AgentPluginSourceType;
}): Promise<AgentPluginDb | undefined> => {
  const [plugin] = await db
    .select()
    .from(agentPlugins)
    .where(
      and(
        eq(agentPlugins.workspaceId, input.workspaceId),
        eq(agentPlugins.ownerUserId, input.ownerUserId),
        eq(agentPlugins.visibility, "user"),
        eq(agentPlugins.checksumSha256, input.checksumSha256),
        isNull(agentPlugins.archivedAt),
        input.sourceType
          ? eq(agentPlugins.sourceType, input.sourceType)
          : undefined,
      ),
    )
    .limit(1);
  return plugin;
};

export const createAgentPluginVersion = async (
  input: NewAgentPlugin,
): Promise<AgentPluginDb> => {
  const [created] = await db.insert(agentPlugins).values(input).returning();
  if (!created) throw new Error("Failed to create agent plugin version");
  return created;
};

export const findOwnedMarketplaceAgentPluginVersion = async (input: {
  workspaceId: string;
  ownerUserId: string;
  marketplaceId: string;
  externalId: string;
  configurationSha256: string;
}): Promise<AgentPluginDb | undefined> => {
  const [plugin] = await db
    .select()
    .from(agentPlugins)
    .where(
      and(
        eq(agentPlugins.workspaceId, input.workspaceId),
        eq(agentPlugins.ownerUserId, input.ownerUserId),
        eq(agentPlugins.visibility, "user"),
        eq(agentPlugins.sourceType, "marketplace"),
        eq(agentPlugins.marketplaceId, input.marketplaceId),
        eq(agentPlugins.externalId, input.externalId),
        sql`${agentPlugins.manifest} ->> 'configurationSha256' = ${input.configurationSha256}`,
        isNull(agentPlugins.archivedAt),
      ),
    )
    .limit(1);
  return plugin;
};

export const listOwnedAgentPackagePlugins = async (
  workspaceId: string,
  ownerUserId: string,
): Promise<AgentPluginDb[]> =>
  db
    .select()
    .from(agentPlugins)
    .where(
      and(
        eq(agentPlugins.workspaceId, workspaceId),
        eq(agentPlugins.ownerUserId, ownerUserId),
        eq(agentPlugins.visibility, "user"),
        inArray(agentPlugins.sourceType, ["marketplace", "upload"]),
        isNull(agentPlugins.archivedAt),
      ),
    )
    .orderBy(desc(agentPlugins.createdAt));

import { and, eq, inArray, isNull, or } from "drizzle-orm";
import { db } from "../../client";
import {
  agentPlugins,
  mcpServers,
  pluginMarketplaces,
  scheduledAgentMcpServers,
} from "../../schema";
import type {
  AgentPluginDb,
  McpServerDb,
  NewAgentPlugin,
  NewMcpServer,
  PluginMarketplaceDb,
} from "../../schema";

export type AgentMcpServerPublic = Omit<
  McpServerDb,
  "encryptedCredentials" | "credentialsIv" | "credentialsAuthTag"
> & {
  hasSecret: boolean;
};

const redactMcpServer = (server: McpServerDb): AgentMcpServerPublic => {
  const { encryptedCredentials, credentialsIv, credentialsAuthTag, ...publicFields } = server;
  void credentialsIv;
  void credentialsAuthTag;
  return {
    ...publicFields,
    hasSecret: Boolean(encryptedCredentials),
  };
};

const mcpAccessCondition = (ownerUserId: string | null) =>
  or(
    eq(mcpServers.visibility, "workspace"),
    eq(mcpServers.visibility, "official"),
    ownerUserId
      ? and(eq(mcpServers.visibility, "user"), eq(mcpServers.ownerUserId, ownerUserId))
      : undefined,
  );

const pluginAccessCondition = (ownerUserId: string | null) =>
  or(
    eq(agentPlugins.visibility, "workspace"),
    eq(agentPlugins.visibility, "official"),
    ownerUserId
      ? and(eq(agentPlugins.visibility, "user"), eq(agentPlugins.ownerUserId, ownerUserId))
      : undefined,
  );

const nonArchivedMcpConditions = (workspaceId: string, ownerUserId: string | null) =>
  and(
    eq(mcpServers.workspaceId, workspaceId),
    isNull(mcpServers.archivedAt),
    mcpAccessCondition(ownerUserId),
  );

const nonArchivedPluginConditions = (workspaceId: string, ownerUserId: string | null) =>
  and(
    eq(agentPlugins.workspaceId, workspaceId),
    isNull(agentPlugins.archivedAt),
    pluginAccessCondition(ownerUserId),
  );

export const listAgentMcpServersByWorkspace = async (
  workspaceId: string,
  ownerUserId: string,
): Promise<AgentMcpServerPublic[]> => {
  const rows = await db
    .select()
    .from(mcpServers)
    .where(nonArchivedMcpConditions(workspaceId, ownerUserId))
    .orderBy(mcpServers.createdAt);

  return rows.map(redactMcpServer);
};

export const getAgentMcpServerById = async (
  id: string,
  workspaceId: string,
  ownerUserId: string | null,
): Promise<McpServerDb | undefined> => {
  const [row] = await db
    .select()
    .from(mcpServers)
    .where(and(eq(mcpServers.id, id), nonArchivedMcpConditions(workspaceId, ownerUserId)))
    .limit(1);
  return row;
};

export const getAgentMcpServersByIds = async (
  workspaceId: string,
  ownerUserId: string | null,
  ids: string[],
): Promise<McpServerDb[]> => {
  const uniqueIds = Array.from(new Set(ids.filter(Boolean)));
  if (uniqueIds.length === 0) return [];

  return db
    .select()
    .from(mcpServers)
    .where(and(nonArchivedMcpConditions(workspaceId, ownerUserId), inArray(mcpServers.id, uniqueIds)));
};

export const getScheduledAgentMcpServerIds = async (
  agentId: string,
): Promise<string[]> => {
  const rows = await db
    .select({ mcpServerId: scheduledAgentMcpServers.mcpServerId })
    .from(scheduledAgentMcpServers)
    .where(
      and(
        eq(scheduledAgentMcpServers.agentId, agentId),
        eq(scheduledAgentMcpServers.enabled, true),
      ),
    )
    .orderBy(scheduledAgentMcpServers.createdAt);

  return rows.map((row) => row.mcpServerId);
};

export const createAgentMcpServer = async (
  data: NewMcpServer,
): Promise<AgentMcpServerPublic> => {
  const [created] = await db.insert(mcpServers).values(data).returning();
  return redactMcpServer(created!);
};

export const updateAgentMcpServer = async (
  id: string,
  workspaceId: string,
  ownerUserId: string,
  data: Partial<Omit<NewMcpServer, "id" | "workspaceId" | "createdAt">>,
): Promise<AgentMcpServerPublic | undefined> => {
  const [updated] = await db
    .update(mcpServers)
    .set({ ...data, updatedAt: new Date() })
    .where(and(eq(mcpServers.id, id), nonArchivedMcpConditions(workspaceId, ownerUserId)))
    .returning();

  return updated ? redactMcpServer(updated) : undefined;
};

export const archiveAgentMcpServer = async (
  id: string,
  workspaceId: string,
  ownerUserId: string,
): Promise<boolean> => {
  const [updated] = await db
    .update(mcpServers)
    .set({ archivedAt: new Date(), updatedAt: new Date() })
    .where(and(eq(mcpServers.id, id), nonArchivedMcpConditions(workspaceId, ownerUserId)))
    .returning({ id: mcpServers.id });

  return Boolean(updated);
};

export const listAgentPluginsByWorkspace = async (
  workspaceId: string,
  ownerUserId: string,
): Promise<AgentPluginDb[]> => {
  return db
    .select()
    .from(agentPlugins)
    .where(nonArchivedPluginConditions(workspaceId, ownerUserId))
    .orderBy(agentPlugins.createdAt);
};

export const getAgentPluginsByIds = async (
  workspaceId: string,
  ownerUserId: string | null,
  ids: string[],
): Promise<AgentPluginDb[]> => {
  const uniqueIds = Array.from(new Set(ids.filter(Boolean)));
  if (uniqueIds.length === 0) return [];

  return db
    .select()
    .from(agentPlugins)
    .where(and(nonArchivedPluginConditions(workspaceId, ownerUserId), inArray(agentPlugins.id, uniqueIds)));
};

export const getAgentPluginMarketplacesByIds = async (
  workspaceId: string,
  ownerUserId: string | null,
  ids: string[],
): Promise<PluginMarketplaceDb[]> => {
  const uniqueIds = Array.from(new Set(ids.filter(Boolean)));
  if (uniqueIds.length === 0) return [];

  return db
    .select()
    .from(pluginMarketplaces)
    .where(
      and(
        eq(pluginMarketplaces.workspaceId, workspaceId),
        or(
          isNull(pluginMarketplaces.ownerUserId),
          ownerUserId
            ? eq(pluginMarketplaces.ownerUserId, ownerUserId)
            : undefined,
        ),
        inArray(pluginMarketplaces.id, uniqueIds),
      ),
    );
};

export const getAgentPluginById = async (
  id: string,
  workspaceId: string,
  ownerUserId: string | null,
): Promise<AgentPluginDb | undefined> => {
  const [row] = await db
    .select()
    .from(agentPlugins)
    .where(and(eq(agentPlugins.id, id), nonArchivedPluginConditions(workspaceId, ownerUserId)))
    .limit(1);
  return row;
};

export const createAgentPlugin = async (
  data: NewAgentPlugin,
): Promise<AgentPluginDb> => {
  const [created] = await db.insert(agentPlugins).values(data).returning();
  return created!;
};

export const updateAgentPlugin = async (
  id: string,
  workspaceId: string,
  ownerUserId: string,
  data: Partial<Omit<NewAgentPlugin, "id" | "workspaceId" | "createdAt">>,
): Promise<AgentPluginDb | undefined> => {
  const [updated] = await db
    .update(agentPlugins)
    .set({ ...data, updatedAt: new Date() })
    .where(and(eq(agentPlugins.id, id), nonArchivedPluginConditions(workspaceId, ownerUserId)))
    .returning();

  return updated;
};

export const archiveAgentPlugin = async (
  id: string,
  workspaceId: string,
  ownerUserId: string,
): Promise<boolean> => {
  const [updated] = await db
    .update(agentPlugins)
    .set({ archivedAt: new Date(), updatedAt: new Date() })
    .where(and(eq(agentPlugins.id, id), nonArchivedPluginConditions(workspaceId, ownerUserId)))
    .returning({ id: agentPlugins.id });

  return Boolean(updated);
};

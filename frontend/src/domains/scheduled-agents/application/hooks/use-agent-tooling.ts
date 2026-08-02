"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { agentToolingApi } from "@/lib/api/client";
import { useActiveTeam } from "@/domains/teams/application/hooks/use-active-team";
import type {
  AgentMcpServer,
  AgentPlugin,
  McpConnectionTestResult,
  McpConnectorTemplate,
  McpConnectorTemplateKey,
  PluginMarketplace,
  CreateAgentMcpServerData,
  CreateAgentPluginData,
  UpdateAgentMcpServerData,
  UpdateAgentPluginData,
} from "../../domain/types";

export const agentToolingKeys = {
  all: ["agent-tooling"] as const,
  mcpServers: () => [...agentToolingKeys.all, "mcp-servers"] as const,
  plugins: () => [...agentToolingKeys.all, "plugins"] as const,
  mcpTemplates: () => [...agentToolingKeys.all, "mcp-templates"] as const,
  marketplaces: () => [...agentToolingKeys.all, "marketplaces"] as const,
  pluginPackages: () => [...agentToolingKeys.all, "plugin-packages"] as const,
};

export const useMcpConnectorTemplates = () =>
  useQuery({
    queryKey: agentToolingKeys.mcpTemplates(),
    queryFn: (): Promise<McpConnectorTemplate[]> => agentToolingApi.listMcpTemplates(),
  });

export const useAgentMcpServers = () => {
  const { confirmedActiveTeamId } = useActiveTeam();

  return useQuery({
    queryKey: [...agentToolingKeys.mcpServers(), `org:${confirmedActiveTeamId ?? "none"}`],
    queryFn: (): Promise<AgentMcpServer[]> => agentToolingApi.listMcpServers(),
    enabled: Boolean(confirmedActiveTeamId),
  });
};

export const useAgentPlugins = () => {
  const { confirmedActiveTeamId } = useActiveTeam();

  return useQuery({
    queryKey: [...agentToolingKeys.plugins(), `org:${confirmedActiveTeamId ?? "none"}`],
    queryFn: (): Promise<AgentPlugin[]> => agentToolingApi.listPlugins(),
    enabled: Boolean(confirmedActiveTeamId),
  });
};

export const useCreateAgentMcpServer = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: CreateAgentMcpServerData) => agentToolingApi.createMcpServer(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: agentToolingKeys.mcpServers() });
    },
  });
};

export const useCreateMcpServerFromTemplate = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: {
      templateKey: McpConnectorTemplateKey;
      name?: string;
      slug?: string;
      description?: string | null;
      secret?: string | null;
      configuration?: Record<string, unknown>;
    }) => agentToolingApi.createMcpServerFromTemplate(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: agentToolingKeys.mcpServers() });
    },
  });
};

export const useTestAgentMcpServer = () =>
  useMutation({
    mutationFn: (input:
      | { id: string }
      | {
          templateKey?: McpConnectorTemplateKey;
          url?: string;
          authType?: import("../../domain/types").McpAuthType;
          authHeaderName?: string | null;
          secret?: string | null;
          configuration?: Record<string, unknown>;
        }): Promise<McpConnectionTestResult> =>
      "id" in input
        ? agentToolingApi.testSavedMcpServer(input.id)
        : agentToolingApi.testMcpServer(input),
  });

export const useUpdateAgentMcpServer = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: UpdateAgentMcpServerData }) =>
      agentToolingApi.updateMcpServer(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: agentToolingKeys.mcpServers() });
    },
  });
};

export const useDeleteAgentMcpServer = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => agentToolingApi.deleteMcpServer(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: agentToolingKeys.mcpServers() });
    },
  });
};

export const useCreateAgentPlugin = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: CreateAgentPluginData) => agentToolingApi.createPlugin(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: agentToolingKeys.plugins() });
    },
  });
};

export const useUpdateAgentPlugin = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: UpdateAgentPluginData }) =>
      agentToolingApi.updatePlugin(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: agentToolingKeys.plugins() });
    },
  });
};

export const useDeleteAgentPlugin = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => agentToolingApi.deletePlugin(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: agentToolingKeys.plugins() });
    },
  });
};

export const usePluginMarketplaces = () => {
  const { confirmedActiveTeamId } = useActiveTeam();
  return useQuery({
    queryKey: [
      ...agentToolingKeys.marketplaces(),
      `org:${confirmedActiveTeamId ?? "none"}`,
    ],
    queryFn: (): Promise<PluginMarketplace[]> =>
      agentToolingApi.listPluginMarketplaces(),
    enabled: Boolean(confirmedActiveTeamId),
  });
};

export const usePluginPackages = () => {
  const { confirmedActiveTeamId } = useActiveTeam();
  return useQuery({
    queryKey: [
      ...agentToolingKeys.pluginPackages(),
      `org:${confirmedActiveTeamId ?? "none"}`,
    ],
    queryFn: (): Promise<AgentPlugin[]> => agentToolingApi.listPluginPackages(),
    enabled: Boolean(confirmedActiveTeamId),
  });
};

const useInvalidatePluginCatalog = () => {
  const queryClient = useQueryClient();
  return () => {
    queryClient.invalidateQueries({ queryKey: agentToolingKeys.marketplaces() });
    queryClient.invalidateQueries({ queryKey: agentToolingKeys.pluginPackages() });
    queryClient.invalidateQueries({ queryKey: agentToolingKeys.plugins() });
  };
};

export const useAddPluginMarketplace = () => {
  const invalidate = useInvalidatePluginCatalog();
  return useMutation({
    mutationFn: (data: { source: string; name?: string | null }) =>
      agentToolingApi.addPluginMarketplace(data),
    onSuccess: invalidate,
  });
};

export const useSyncPluginMarketplace = () => {
  const invalidate = useInvalidatePluginCatalog();
  return useMutation({
    mutationFn: (id: string) => agentToolingApi.syncPluginMarketplace(id),
    onSuccess: invalidate,
  });
};

export const useDeletePluginMarketplace = () => {
  const invalidate = useInvalidatePluginCatalog();
  return useMutation({
    mutationFn: (id: string) => agentToolingApi.deletePluginMarketplace(id),
    onSuccess: invalidate,
  });
};

export const useInstallMarketplacePlugin = () => {
  const invalidate = useInvalidatePluginCatalog();
  return useMutation({
    mutationFn: (input: { marketplaceId: string; externalId: string }) =>
      agentToolingApi.installMarketplacePlugin(
        input.marketplaceId,
        input.externalId,
      ),
    onSuccess: invalidate,
  });
};

export const useUploadPluginPackage = () => {
  const invalidate = useInvalidatePluginCatalog();
  return useMutation({
    mutationFn: (input: { file: File; name?: string; description?: string }) =>
      agentToolingApi.uploadPluginPackage(input),
    onSuccess: invalidate,
  });
};

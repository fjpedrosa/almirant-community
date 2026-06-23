"use client";

import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { agentsApi } from "@/lib/api/client";
import { useOrgScopedKey } from "@/lib/query-keys";
import { showToast } from "@/domains/shared/presentation/utils/show-toast";
import { useProjects } from "@/domains/projects/application/hooks/use-projects";
import type { ProjectWithRelations } from "@/domains/projects/domain/types";
import type {
  AgentConnection,
  AgentConnectionPrompt,
} from "../../domain/types";

export const ALL_PROJECTS_AGENT_SCOPE = "__all_projects__";

export const agentConnectionKeys = {
  all: ["agent-connections"] as const,
  lists: () => [...agentConnectionKeys.all, "list"] as const,
};

export const useAgentConnections = () => {
  const queryClient = useQueryClient();
  const scopedListKey = useOrgScopedKey(agentConnectionKeys.lists());
  const { data: projects = [], isLoading: isLoadingProjects } = useProjects();
  const projectOptions = projects as ProjectWithRelations[];
  const [selectedProjectId, setSelectedProjectId] = useState(ALL_PROJECTS_AGENT_SCOPE);
  const [agentName, setAgentName] = useState("OpenClaw Agent");
  const [generatedPrompt, setGeneratedPrompt] = useState<AgentConnectionPrompt | null>(null);

  const connectionsQuery = useQuery({
    queryKey: scopedListKey,
    queryFn: () => agentsApi.listAgentConnections() as Promise<AgentConnection[]>,
  });

  const createPrompt = useMutation({
    mutationFn: () =>
      agentsApi.createAgentConnectionPrompt({
        projectId:
          selectedProjectId === ALL_PROJECTS_AGENT_SCOPE
            ? null
            : selectedProjectId,
        agentName,
      }) as Promise<AgentConnectionPrompt>,
    onSuccess: async (prompt) => {
      setGeneratedPrompt(prompt);
      try {
        await navigator.clipboard.writeText(prompt.prompt);
        showToast.success("Prompt generated and copied");
      } catch {
        showToast.success("Prompt generated");
      }
    },
    onError: (error) => {
      showToast.error(error instanceof Error ? error.message : "Failed to generate prompt");
    },
  });

  const revokeConnection = useMutation({
    mutationFn: (id: string) => agentsApi.revokeAgentConnection(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: scopedListKey });
      showToast.success("Agent connection revoked");
    },
    onError: (error) => {
      showToast.error(error instanceof Error ? error.message : "Failed to revoke connection");
    },
  });

  const copyPrompt = async () => {
    if (!generatedPrompt) return;
    await navigator.clipboard.writeText(generatedPrompt.prompt);
    showToast.success("Prompt copied");
  };

  const canGenerate = selectedProjectId.length > 0 && !createPrompt.isPending;

  return {
    projectOptions: useMemo(
      () => [
        { id: ALL_PROJECTS_AGENT_SCOPE, name: "All projects" },
        ...projectOptions.map((project) => ({ id: project.id, name: project.name })),
      ],
      [projectOptions],
    ),
    selectedProjectId,
    setSelectedProjectId,
    agentName,
    setAgentName,
    generatedPrompt,
    connections: connectionsQuery.data ?? [],
    isLoading: isLoadingProjects || connectionsQuery.isLoading,
    isGenerating: createPrompt.isPending,
    isRevoking: revokeConnection.isPending,
    canGenerate,
    generatePrompt: () => createPrompt.mutate(),
    copyPrompt,
    revokeConnection: (id: string) => revokeConnection.mutate(id),
  };
};

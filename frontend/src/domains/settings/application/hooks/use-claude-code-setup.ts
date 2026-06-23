'use client';

import { useCallback, useMemo, useState } from 'react';
import { showToast } from '@/domains/shared/presentation/utils/show-toast';
import { useProjects } from '@/domains/projects/application/hooks/use-projects';
import { useApiKeys } from '@/domains/api-keys/application/hooks/use-api-keys';
import type { ProjectWithRelations } from '@/domains/projects/domain/types';
import type { ApiKey } from '@/domains/api-keys/domain/types';

const MCP_URL =
  process.env.NEXT_PUBLIC_MCP_URL || 'https://api.almirant.ai/mcp';
const DOCS_URL = 'https://modelcontextprotocol.io/';

export const useClaudeCodeSetup = () => {
  const { data: projects, isLoading: isLoadingProjects } = useProjects();
  const { data: apiKeys, isLoading: isLoadingApiKeys } = useApiKeys();

  const projectOptions = useMemo(() => {
    return (projects ?? []) as ProjectWithRelations[];
  }, [projects]);
  const apiKeyOptions = useMemo(() => {
    return ((apiKeys ?? []) as ApiKey[]).filter((key) => key.isActive);
  }, [apiKeys]);

  const [selectedProjectId, setSelectedProjectId] = useState('');
  const [selectedApiKeyId, setSelectedApiKeyId] = useState('');

  const selectedProject = useMemo(
    () =>
      projectOptions.find((project) => project.id === selectedProjectId) ??
      null,
    [projectOptions, selectedProjectId],
  );
  const selectedApiKey = useMemo(
    () =>
      apiKeyOptions.find((apiKey) => apiKey.id === selectedApiKeyId) ?? null,
    [apiKeyOptions, selectedApiKeyId],
  );

  const isConnected = useMemo(() => {
    return apiKeyOptions.some((apiKey) => apiKey.lastUsedAt !== null);
  }, [apiKeyOptions]);

  const snippet = useMemo(() => {
    if (!selectedProject || !selectedApiKey) return '';
    return JSON.stringify(
      {
        mcpServers: {
          almirant: {
            type: 'http',
            url: `${MCP_URL}?projectId=${selectedProject.id}`,
            headers: {
              Authorization: `Bearer ${selectedApiKey.keyPrefix}<your-full-api-key>`,
            },
          },
        },
      },
      null,
      2,
    );
  }, [selectedApiKey, selectedProject]);

  const copySnippet = useCallback(() => {
    if (!snippet) return;
    navigator.clipboard.writeText(snippet);
    showToast.success('Configuración copiada');
  }, [snippet]);

  return {
    isLoading: isLoadingProjects || isLoadingApiKeys,
    projectOptions: projectOptions.map((project) => ({
      id: project.id,
      name: project.name,
    })),
    apiKeyOptions,
    selectedProjectId,
    selectedApiKeyId,
    snippet,
    isConnected,
    docsUrl: DOCS_URL,
    setSelectedProjectId,
    setSelectedApiKeyId,
    copySnippet,
  };
};

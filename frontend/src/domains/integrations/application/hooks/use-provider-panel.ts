"use client";

import { useState, useCallback, useMemo, useEffect } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useTranslations } from "next-intl";
import { showToast } from "@/domains/shared/presentation/utils/show-toast";
import { useConfirmDialog } from "@/domains/shared/application/hooks/use-confirm-dialog";
import { getModelsForProvider, getModelsGroupedByCategory } from "@/lib/ai-models-catalog";
import {
  useConnections,
  useCreateConnection,
  useDeleteConnection,
  useTestConnection,
  useTestCredentials,
  useSetDefaultConnection,
  useUpdateConnection,
  useReorderConnections,
} from "./use-connections";
import type {
  AddKeyFormData,
  AddKeyFormState,
  ProviderConnection,
  ProviderPanelState,
  TestConnectionResult,
  UpdateConnectionInput,
} from "../../domain/types";

export interface ProviderPanelHookReturn {
  connections: ProviderConnection[];
  isLoadingConnections: boolean;
  defaultConnection: ProviderConnection | null;
  connectionCount: number;

  availableModels: ReturnType<typeof getModelsForProvider>;
  modelsByCategory: ReturnType<typeof getModelsGroupedByCategory>;

  modelSettings: {
    planningModel: string;
    implementationModel: string;
    validationModel: string;
    planningReasoningBudget: string;
    implementationReasoningBudget: string;
    validationReasoningBudget: string;
  };
  hasModelChanges: boolean;
  isSavingModelSettings: boolean;
  handleModelSettingChange: (field: "planningModel" | "implementationModel" | "validationModel" | "planningReasoningBudget" | "implementationReasoningBudget" | "validationReasoningBudget", value: string) => void;
  handleSaveModelSettings: () => Promise<void>;
  isModelsSectionExpanded: boolean;
  setModelsSectionExpanded: (expanded: boolean) => void;

  addKeyForm: AddKeyFormState;

  editingConnectionId: string | null;
  editName: string;
  editToken: string;
  isSavingEdit: boolean;
  handleStartEdit: (connectionId: string) => void;
  handleCancelEdit: () => void;
  handleSaveEdit: () => Promise<void>;
  setEditName: (value: string) => void;
  setEditToken: (value: string) => void;

  handleSetDefault: (connectionId: string) => Promise<void>;
  handleDeleteKey: (connectionId: string) => Promise<void>;
  handleTestKey: (connectionId: string) => Promise<void>;
  handleMovePriorityUp: (connectionId: string) => Promise<void>;
  handleMovePriorityDown: (connectionId: string) => Promise<void>;
  isReordering: boolean;
  handleToggleOrchestration: (connectionId: string) => Promise<void>;

  testingStates: Record<string, boolean>;
  testResults: Record<string, TestConnectionResult>;

  resetState: () => void;

  confirmDialog: {
    isOpen: boolean;
    options: import("@/domains/shared/domain/types").ConfirmDialogOptions | null;
    handleConfirm: () => void;
    handleCancel: () => void;
  };
}

const ANTHROPIC_SETUP_TOKEN_PREFIX = "sk-ant-oat01-";

const ZAI_BASE_URLS: Record<string, string> = {
  coding: "https://api.z.ai/api/coding/paas/v4",
  standard: "https://api.z.ai/api/paas/v4",
};
const XAI_BASE_URL = "https://api.x.ai/v1";

const DEFAULT_ADD_KEY_VALUES: AddKeyFormData = {
  name: "",
  apiKey: "",
  baseUrl: "",
  authMethod: "api_key",
  planningModel: "",
  implementationModel: "",
  validationModel: "",
  planningReasoningBudget: "",
  implementationReasoningBudget: "",
  validationReasoningBudget: "",
};

const addKeySchema = z.object({
  name: z.string().min(1, "Name is required"),
  apiKey: z.string().min(10, "API key must be at least 10 characters"),
  baseUrl: z.string().url("Must be a valid URL").optional().or(z.literal("")),
  authMethod: z.enum(["api_key", "setup_token", "subscription"] as const).optional(),
  planningModel: z.string().optional().or(z.literal("")),
  implementationModel: z.string().optional().or(z.literal("")),
  validationModel: z.string().optional().or(z.literal("")),
  planningReasoningBudget: z.string().optional().or(z.literal("")),
  implementationReasoningBudget: z.string().optional().or(z.literal("")),
  validationReasoningBudget: z.string().optional().or(z.literal("")),
});

const PROVIDER_CATEGORY_MAP = {
  openai: "ai",
  anthropic: "ai",
  google: "ai",
  zai: "ai",
} as const;

const normalizeOptional = (value?: string): string | undefined => {
  if (!value) return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
};

const readConnectionModels = (connection: ProviderConnection | null) => {
  const config = (connection?.config ?? {}) as Record<string, unknown>;
  return {
    planningModel: typeof config.planningModel === "string" ? config.planningModel : "",
    implementationModel: typeof config.implementationModel === "string" ? config.implementationModel : "",
    validationModel: typeof config.validationModel === "string" ? config.validationModel : "",
    planningReasoningBudget: typeof config.planningReasoningBudget === "string" ? config.planningReasoningBudget : "",
    implementationReasoningBudget: typeof config.implementationReasoningBudget === "string" ? config.implementationReasoningBudget : "",
    validationReasoningBudget: typeof config.validationReasoningBudget === "string" ? config.validationReasoningBudget : "",
  };
};

export const useProviderPanel = (panelState: ProviderPanelState | null): ProviderPanelHookReturn => {
  const t = useTranslations("integrations.toasts");
  const { confirm, ...confirmDialog } = useConfirmDialog();

  const [showAddForm, setShowAddForm] = useState(false);
  const [isModelsSectionExpanded, setModelsSectionExpanded] = useState(false);
  const [isTestingNewKey, setIsTestingNewKey] = useState(false);
  const [testError, setTestError] = useState<string | null>(null);

  const [testingStates, setTestingStates] = useState<Record<string, boolean>>({});
  const [testResults, setTestResults] = useState<Record<string, TestConnectionResult>>({});

  const [editingConnectionId, setEditingConnectionId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editToken, setEditToken] = useState("");

  const [modelSettings, setModelSettings] = useState({
    planningModel: "",
    implementationModel: "",
    validationModel: "",
    planningReasoningBudget: "",
    implementationReasoningBudget: "",
    validationReasoningBudget: "",
  });

  const addKeyForm = useForm<AddKeyFormData>({
    resolver: zodResolver(addKeySchema),
    mode: "onChange",
    defaultValues: DEFAULT_ADD_KEY_VALUES,
  });

  const createConnection = useCreateConnection();
  const deleteConnection = useDeleteConnection();
  const updateConnection = useUpdateConnection();
  const updateModelsConnection = useUpdateConnection();
  const testConnection = useTestConnection();
  const testCredentials = useTestCredentials();
  const setDefaultConnection = useSetDefaultConnection();
  const reorderConnections = useReorderConnections();

  const connectionsParams = useMemo(() => {
    if (!panelState) return undefined;

    const params = new URLSearchParams({
      provider: panelState.provider,
      scope: panelState.scope,
      category: "ai",
    });

    return params;
  }, [panelState]);

  const { data: rawConnections = [], isLoading: isLoadingConnections } = useConnections(connectionsParams);

  const connections = useMemo(
    () =>
      [...rawConnections].sort((a, b) => {
        const pa = a.priority ?? Number.MAX_SAFE_INTEGER;
        const pb = b.priority ?? Number.MAX_SAFE_INTEGER;
        return pa - pb;
      }),
    [rawConnections],
  );

  const defaultConnection = useMemo(
    () => connections.find((connection) => connection.isDefault) ?? connections[0] ?? null,
    [connections],
  );

  const connectionCount = connections.length;

  const availableModels = useMemo(
    () => (panelState ? getModelsForProvider(panelState.provider) : []),
    [panelState],
  );

  const modelsByCategory = useMemo(
    () =>
      panelState
        ? getModelsGroupedByCategory(panelState.provider)
        : {
            best: [],
            fast: [],
            cheap: [],
            reasoning: [],
          },
    [panelState],
  );

  const sourceModelSettings = useMemo(
    () => readConnectionModels(defaultConnection),
    [defaultConnection],
  );

  useEffect(() => {
    setModelSettings(sourceModelSettings);
  }, [sourceModelSettings]);

  const hasModelChanges =
    modelSettings.planningModel !== sourceModelSettings.planningModel ||
    modelSettings.implementationModel !== sourceModelSettings.implementationModel ||
    modelSettings.validationModel !== sourceModelSettings.validationModel ||
    modelSettings.planningReasoningBudget !== sourceModelSettings.planningReasoningBudget ||
    modelSettings.implementationReasoningBudget !== sourceModelSettings.implementationReasoningBudget ||
    modelSettings.validationReasoningBudget !== sourceModelSettings.validationReasoningBudget;

  const resetEditState = useCallback(() => {
    setEditingConnectionId(null);
    setEditName("");
    setEditToken("");
  }, []);

  const resetState = useCallback(() => {
    setShowAddForm(false);
    setModelsSectionExpanded(false);
    setTestError(null);
    setTestingStates({});
    setTestResults({});
    addKeyForm.reset(DEFAULT_ADD_KEY_VALUES);
    resetEditState();
  }, [addKeyForm, resetEditState]);

  const showAddKeyForm = useCallback(() => {
    setShowAddForm(true);
    addKeyForm.reset(DEFAULT_ADD_KEY_VALUES);
    setTestError(null);
  }, [addKeyForm]);

  const hideAddKeyForm = useCallback(() => {
    setShowAddForm(false);
    addKeyForm.reset(DEFAULT_ADD_KEY_VALUES);
    setTestError(null);
  }, [addKeyForm]);

  const handleAddKeySubmit = useCallback(
    async (data: AddKeyFormData) => {
      if (!panelState) return;

      setTestError(null);

      let authMethod = data.authMethod;
      if (panelState.provider === "anthropic" && !authMethod && data.apiKey) {
        authMethod = data.apiKey.startsWith(ANTHROPIC_SETUP_TOKEN_PREFIX) ? "setup_token" : "api_key";
      }

      const planningModel = normalizeOptional(data.planningModel);
      const implementationModel = normalizeOptional(data.implementationModel);
      const validationModel = normalizeOptional(data.validationModel);
      const planningReasoningBudget = normalizeOptional(data.planningReasoningBudget);
      const implementationReasoningBudget = normalizeOptional(data.implementationReasoningBudget);
      const validationReasoningBudget = normalizeOptional(data.validationReasoningBudget);
      const baseUrl = panelState.provider === "zai"
        ? ZAI_BASE_URLS.coding
        : normalizeOptional(data.baseUrl);

      const credentials: Record<string, unknown> = {
        apiKey: data.apiKey,
      };

      if (panelState.provider === "anthropic" && authMethod) {
        credentials.authMethod = authMethod;
      }
      if (baseUrl) {
        credentials.baseUrl = baseUrl;
      }

      const config: Record<string, unknown> = {};
      if (panelState.provider === "anthropic" && authMethod) {
        config.authMethod = authMethod;
      }
      if (baseUrl) {
        config.baseUrl = baseUrl;
      }
      if (panelState.provider === "zai") {
        config.zaiPlan = "coding";
      }
      if (planningModel) {
        config.planningModel = planningModel;
      }
      if (implementationModel) {
        config.implementationModel = implementationModel;
      }
      if (validationModel) {
        config.validationModel = validationModel;
      }
      if (planningReasoningBudget) {
        config.planningReasoningBudget = planningReasoningBudget;
      }
      if (implementationReasoningBudget) {
        config.implementationReasoningBudget = implementationReasoningBudget;
      }
      if (validationReasoningBudget) {
        config.validationReasoningBudget = validationReasoningBudget;
      }

      setIsTestingNewKey(true);
      try {
        const testResult = await testCredentials.mutateAsync({
          provider: panelState.provider,
          credentials,
          config: Object.keys(config).length > 0 ? config : undefined,
        });

        if (!testResult.valid) {
          setTestError(testResult.error ?? "API key verification failed. Please check your credentials.");
          setIsTestingNewKey(false);
          return;
        }
      } catch {
        setTestError("Could not verify credentials. Please try again.");
        setIsTestingNewKey(false);
        return;
      }
      setIsTestingNewKey(false);

      try {
        await createConnection.mutateAsync({
          provider: panelState.provider,
          category: PROVIDER_CATEGORY_MAP[panelState.provider as keyof typeof PROVIDER_CATEGORY_MAP] || "ai",
          scope: panelState.scope,
          name: data.name,
          accountIdentifier: `${String(data.apiKey).slice(0, 7)}...`,
          credentials,
          config,
          ...(connections.length === 0 ? { isDefault: true } : {}),
        });

        showToast.success(t("apiKeyAdded"));
        hideAddKeyForm();
      } catch {
        showToast.error(t("apiKeyAddFailed"));
      }
    },
    [panelState, testCredentials, createConnection, hideAddKeyForm, connections.length, t],
  );

  const handleModelSettingChange = useCallback(
    (field: "planningModel" | "implementationModel" | "validationModel" | "planningReasoningBudget" | "implementationReasoningBudget" | "validationReasoningBudget", value: string) => {
      setModelSettings((previous) => ({
        ...previous,
        [field]: value,
      }));
    },
    [],
  );

  const handleSaveModelSettings = useCallback(async () => {
    if (!panelState || connections.length === 0) return;

    try {
      for (const connection of connections) {
        const existingConfig = { ...((connection.config ?? {}) as Record<string, unknown>) };

        const planningModel = normalizeOptional(modelSettings.planningModel);
        const implementationModel = normalizeOptional(modelSettings.implementationModel);
        const validationModel = normalizeOptional(modelSettings.validationModel);
        const planningReasoningBudget = normalizeOptional(modelSettings.planningReasoningBudget);
        const implementationReasoningBudget = normalizeOptional(modelSettings.implementationReasoningBudget);
        const validationReasoningBudget = normalizeOptional(modelSettings.validationReasoningBudget);

        if (planningModel) {
          existingConfig.planningModel = planningModel;
        } else {
          delete existingConfig.planningModel;
        }

        if (implementationModel) {
          existingConfig.implementationModel = implementationModel;
        } else {
          delete existingConfig.implementationModel;
        }

        if (validationModel) {
          existingConfig.validationModel = validationModel;
        } else {
          delete existingConfig.validationModel;
        }

        if (planningReasoningBudget) {
          existingConfig.planningReasoningBudget = planningReasoningBudget;
        } else {
          delete existingConfig.planningReasoningBudget;
        }

        if (implementationReasoningBudget) {
          existingConfig.implementationReasoningBudget = implementationReasoningBudget;
        } else {
          delete existingConfig.implementationReasoningBudget;
        }

        if (validationReasoningBudget) {
          existingConfig.validationReasoningBudget = validationReasoningBudget;
        } else {
          delete existingConfig.validationReasoningBudget;
        }

        await updateModelsConnection.mutateAsync({
          id: connection.id,
          data: {
            config: existingConfig,
          },
        });
      }

      showToast.success(t("modelSettingsUpdated"));
    } catch {
      showToast.error(t("modelSettingsFailed"));
    }
  }, [panelState, connections, modelSettings, updateModelsConnection, t]);

  const handleStartEdit = useCallback(
    (connectionId: string) => {
      const connection = connections.find((item) => item.id === connectionId);
      if (!connection) return;

      setEditingConnectionId(connectionId);
      setEditName(connection.name);
      setEditToken("");
    },
    [connections],
  );

  const handleCancelEdit = useCallback(() => {
    resetEditState();
  }, [resetEditState]);

  const handleSaveEdit = useCallback(async () => {
    if (!editingConnectionId) return;

    const connection = connections.find((item) => item.id === editingConnectionId);
    if (!connection) return;

    const nextName = editName.trim();
    if (nextName.length === 0) {
      showToast.error(t("nameRequired"));
      return;
    }

    const payload: UpdateConnectionInput = {
      name: nextName,
    };

    const nextToken = editToken.trim();
    if (nextToken.length > 0) {
      payload.credentials = { apiKey: nextToken };
      payload.accountIdentifier = `${nextToken.slice(0, 7)}...`;
    }

    try {
      await updateConnection.mutateAsync({
        id: editingConnectionId,
        data: payload,
      });

      showToast.success(t("apiKeyUpdated"));
      resetEditState();
    } catch {
      showToast.error(t("apiKeyUpdateFailed"));
    }
  }, [editingConnectionId, connections, editName, editToken, updateConnection, resetEditState, t]);

  const handleSetDefault = useCallback(
    async (connectionId: string) => {
      try {
        await setDefaultConnection.mutateAsync(connectionId);
        showToast.success(t("defaultConnectionUpdated"));
      } catch {
        showToast.error(t("defaultConnectionFailed"));
      }
    },
    [setDefaultConnection, t],
  );

  const handleDeleteKey = useCallback(
    async (connectionId: string) => {
      const connection = connections.find((item) => item.id === connectionId);
      if (!connection) return;

      const confirmed = await confirm({
        title: "Delete API Key",
        description: `Are you sure you want to delete "${connection.name}"? This action cannot be undone.`,
        confirmLabel: "Delete",
        variant: "destructive",
      });

      if (!confirmed) return;

      try {
        await deleteConnection.mutateAsync(connectionId);
        showToast.success(t("apiKeyDeleted"));
      } catch {
        showToast.error(t("apiKeyDeleteFailed"));
      }
    },
    [connections, confirm, deleteConnection, t],
  );

  const handleTestKey = useCallback(
    async (connectionId: string) => {
      setTestingStates((previous) => ({ ...previous, [connectionId]: true }));

      try {
        const result = await testConnection.mutateAsync(connectionId);
        setTestResults((previous) => ({ ...previous, [connectionId]: result }));

        if (result.valid) {
          showToast.success(t("testPassed"));
        } else {
          showToast.error(t("testFailed", { error: result.error || "Unknown error" }));
        }
      } catch {
        showToast.error(t("testError"));
      } finally {
        setTestingStates((previous) => ({ ...previous, [connectionId]: false }));
      }
    },
    [testConnection, t],
  );

  const handleMovePriorityUp = useCallback(
    async (connectionId: string) => {
      const index = connections.findIndex((c) => c.id === connectionId);
      if (index <= 0) return;

      const reordered = [...connections];
      [reordered[index - 1], reordered[index]] = [reordered[index], reordered[index - 1]];

      try {
        await reorderConnections.mutateAsync(reordered.map((c) => c.id));
        showToast.success(t("priorityUpdated"));
      } catch {
        showToast.error(t("priorityFailed"));
      }
    },
    [connections, reorderConnections, t],
  );

  const handleMovePriorityDown = useCallback(
    async (connectionId: string) => {
      const index = connections.findIndex((c) => c.id === connectionId);
      if (index < 0 || index >= connections.length - 1) return;

      const reordered = [...connections];
      [reordered[index], reordered[index + 1]] = [reordered[index + 1], reordered[index]];

      try {
        await reorderConnections.mutateAsync(reordered.map((c) => c.id));
        showToast.success(t("priorityUpdated"));
      } catch {
        showToast.error(t("priorityFailed"));
      }
    },
    [connections, reorderConnections, t],
  );

  const handleToggleOrchestration = useCallback(
    async (connectionId: string) => {
      const connection = connections.find((c) => c.id === connectionId);
      if (!connection) return;

      try {
        await updateConnection.mutateAsync({
          id: connectionId,
          data: { orchestrationEnabled: !connection.orchestrationEnabled },
        });
        showToast.success(
          connection.orchestrationEnabled
            ? t("orchestrationDisabled")
            : t("orchestrationEnabled"),
        );
      } catch {
        showToast.error(t("orchestrationFailed"));
      }
    },
    [connections, updateConnection, t],
  );

  return {
    connections,
    isLoadingConnections,
    defaultConnection,
    connectionCount,

    availableModels,
    modelsByCategory,

    modelSettings,
    hasModelChanges,
    isSavingModelSettings: updateModelsConnection.isPending,
    handleModelSettingChange,
    handleSaveModelSettings,
    isModelsSectionExpanded,
    setModelsSectionExpanded,

    addKeyForm: {
      form: addKeyForm,
      isVisible: showAddForm,
      showForm: showAddKeyForm,
      hideForm: hideAddKeyForm,
      onSubmit: handleAddKeySubmit,
      isSubmitting: createConnection.isPending,
      isTesting: isTestingNewKey,
      testError,
    },

    editingConnectionId,
    editName,
    editToken,
    isSavingEdit: updateConnection.isPending,
    handleStartEdit,
    handleCancelEdit,
    handleSaveEdit,
    setEditName,
    setEditToken,

    handleSetDefault,
    handleDeleteKey,
    handleTestKey,
    handleMovePriorityUp,
    handleMovePriorityDown,
    isReordering: reorderConnections.isPending,
    handleToggleOrchestration,

    testingStates,
    testResults,

    resetState,

    confirmDialog,
  };
};

"use client";

import { useState, useCallback, useEffect, useMemo } from "react";
import { useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useTranslations } from "next-intl";
import { showToast } from "@/domains/shared/presentation/utils/show-toast";
import { useCreateConnection, useTestCredentials, useUpdateConnection } from "./use-connections";
import { getModelsForProvider } from "@/lib/ai-models-catalog";
import type {
  ApiKeyConnectFormData,
  ApiKeyManageConnection,
  ApiKeyProvider,
  ConnectionCategory,
  ConnectionScope,
  UseApiKeyConnectFormReturn,
} from "../../domain/types";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const ANTHROPIC_SETUP_TOKEN_PREFIX = "sk-ant-oat01-";
const ZAI_BASE_URLS: Record<string, string> = {
  coding: "https://api.z.ai/api/coding/paas/v4",
  standard: "https://api.z.ai/api/paas/v4",
};
const XAI_BASE_URL = "https://api.x.ai/v1";

const DEFAULT_FORM_VALUES: ApiKeyConnectFormData = {
  name: "",
  provider: "anthropic",
  apiKey: "",
  baseUrl: "",
  authMethod: "api_key",
  planningModel: "",
  implementationModel: "",
  validationModel: "",
  planningReasoningBudget: "",
  implementationReasoningBudget: "",
  validationReasoningBudget: "",
  connectionId: undefined,
};

// ---------------------------------------------------------------------------
// Zod schema
// ---------------------------------------------------------------------------

const apiKeyConnectSchema = z
  .object({
    name: z.string().min(1, "Name is required"),
    provider: z.enum(
      ["openai", "anthropic", "google", "zai", "xai", "sentry", "posthog", "zipu", "gitlab"] as const,
      { message: "Provider is required" },
    ),
    apiKey: z.string().optional().or(z.literal("")),
    baseUrl: z
      .string()
      .url("Must be a valid URL")
      .optional()
      .or(z.literal("")),
    authMethod: z
      .enum(["api_key", "setup_token", "subscription"] as const)
      .optional(),
    planningModel: z.string().optional().or(z.literal("")),
    implementationModel: z.string().optional().or(z.literal("")),
    validationModel: z.string().optional().or(z.literal("")),
    planningReasoningBudget: z.string().optional().or(z.literal("")),
    implementationReasoningBudget: z.string().optional().or(z.literal("")),
    validationReasoningBudget: z.string().optional().or(z.literal("")),
    connectionId: z.string().optional(),
  })
  .refine(
    (data) => {
      if (data.connectionId) return true;
      if (data.authMethod === "subscription") return true;
      return !!data.apiKey && data.apiKey.trim().length >= 10;
    },
    {
      message: "API key must be at least 10 characters",
      path: ["apiKey"],
    },
  )
;

// ---------------------------------------------------------------------------
// Provider -> category mapping
// ---------------------------------------------------------------------------

const PROVIDER_CATEGORY: Record<ApiKeyProvider, ConnectionCategory> = {
  openai: "ai",
  anthropic: "ai",
  google: "ai",
  zai: "ai",
  xai: "ai",
  sentry: "monitoring",
  posthog: "monitoring",
  zipu: "ai",
  gitlab: "code",
};

// ---------------------------------------------------------------------------
// useApiKeyConnectForm
// ---------------------------------------------------------------------------
// Manages form state, validation, and submission for API key connections.
// Flow: test credentials FIRST, only create the connection if valid.
// ---------------------------------------------------------------------------

export const useApiKeyConnectForm = (
  scope: ConnectionScope,
): UseApiKeyConnectFormReturn => {
  const t = useTranslations("integrations.toasts");
  const createConnection = useCreateConnection();
  const updateConnection = useUpdateConnection();
  const testCredentials = useTestCredentials();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [isTesting, setIsTesting] = useState(false);
  const [testError, setTestError] = useState<string | null>(null);
  const [providerLocked, setProviderLocked] = useState(false);
  const [activeScope, setActiveScope] = useState<ConnectionScope>(scope);
  const [editingConnectionConfig, setEditingConnectionConfig] = useState<Record<string, unknown> | null>(null);

  const form = useForm<ApiKeyConnectFormData>({
    resolver: zodResolver(apiKeyConnectSchema),
    mode: "onChange",
    defaultValues: DEFAULT_FORM_VALUES,
  });

  const isFormValid = form.formState.isValid;
  const selectedProvider = useWatch({
    control: form.control,
    name: "provider",
  });
  const connectionId = useWatch({
    control: form.control,
    name: "connectionId",
  });
  const isEditing = Boolean(connectionId);

  useEffect(() => {
    setActiveScope(scope);
  }, [scope]);

  const handleOpenChange = useCallback(
    (open: boolean) => {
      setDialogOpen(open);
      if (!open) {
        form.reset(DEFAULT_FORM_VALUES);
        setTestError(null);
        setProviderLocked(false);
        setActiveScope(scope);
        setEditingConnectionConfig(null);
      }
    },
    [form, scope],
  );

  /** Open dialog with a pre-selected (locked) provider */
  const openForProvider = useCallback(
    (
      provider: ApiKeyProvider,
      scopeOverride?: ConnectionScope,
      existing?: ApiKeyManageConnection
    ) => {
      const existingConfig = (existing?.config ?? {}) as Record<string, unknown>;
      const existingAuthMethod =
        existingConfig.authMethod === "api_key" || existingConfig.authMethod === "setup_token"
          ? existingConfig.authMethod
          : undefined;

      form.reset({
        ...DEFAULT_FORM_VALUES,
        name: existing?.name ?? "",
        provider,
        apiKey: "",
        baseUrl: typeof existingConfig.baseUrl === "string" ? existingConfig.baseUrl : "",
        authMethod: provider === "anthropic" ? (existingAuthMethod ?? "api_key") : undefined,
        planningModel:
          typeof existingConfig.planningModel === "string" ? existingConfig.planningModel : "",
        implementationModel:
          typeof existingConfig.implementationModel === "string" ? existingConfig.implementationModel : "",
        validationModel:
          typeof existingConfig.validationModel === "string" ? existingConfig.validationModel : "",
        planningReasoningBudget:
          typeof existingConfig.planningReasoningBudget === "string" ? existingConfig.planningReasoningBudget : "",
        implementationReasoningBudget:
          typeof existingConfig.implementationReasoningBudget === "string" ? existingConfig.implementationReasoningBudget : "",
        validationReasoningBudget:
          typeof existingConfig.validationReasoningBudget === "string" ? existingConfig.validationReasoningBudget : "",
        connectionId: existing?.id,
      });
      setActiveScope(scopeOverride ?? scope);
      setProviderLocked(true);
      setEditingConnectionConfig(existingConfig);
      setDialogOpen(true);
    },
    [form, scope],
  );

  const onSubmit = useCallback(
    async (data: ApiKeyConnectFormData) => {
      // Clear previous test error on re-submit
      setTestError(null);
      const isEditingConnection = !!data.connectionId;

      // Resolve authMethod for Anthropic: use explicit choice, or auto-detect
      let authMethod = data.authMethod;
      if (data.provider === "anthropic" && !authMethod && data.apiKey) {
        authMethod = data.apiKey.startsWith(ANTHROPIC_SETUP_TOKEN_PREFIX)
          ? "setup_token"
          : "api_key";
      }

      const normalizeOptional = (value?: string): string | undefined => {
        if (!value) return undefined;
        const trimmed = value.trim();
        return trimmed.length > 0 ? trimmed : undefined;
      };

      const planningModel = normalizeOptional(data.planningModel);
      const implementationModel = normalizeOptional(data.implementationModel);
      const validationModel = normalizeOptional(data.validationModel);
      const planningReasoningBudget = normalizeOptional(data.planningReasoningBudget);
      const implementationReasoningBudget = normalizeOptional(data.implementationReasoningBudget);
      const validationReasoningBudget = normalizeOptional(data.validationReasoningBudget);
      const baseUrl = data.provider === "zai"
        ? ZAI_BASE_URLS.coding
        : data.provider === "xai"
          ? XAI_BASE_URL
          : normalizeOptional(data.baseUrl);

      if (isEditingConnection) {
        const config = { ...(editingConnectionConfig ?? {}) } as Record<string, unknown>;
        if (data.provider === "anthropic" && authMethod) {
          config.authMethod = authMethod;
        }
        if (data.provider === "zai") {
          config.baseUrl = baseUrl;
          config.zaiPlan = "coding";
        }
        if (data.provider === "xai") {
          config.baseUrl = baseUrl;
        }
        if (planningModel) {
          config.planningModel = planningModel;
        } else {
          delete config.planningModel;
        }
        if (implementationModel) {
          config.implementationModel = implementationModel;
        } else {
          delete config.implementationModel;
        }
        if (validationModel) {
          config.validationModel = validationModel;
        } else {
          delete config.validationModel;
        }
        if (planningReasoningBudget) {
          config.planningReasoningBudget = planningReasoningBudget;
        } else {
          delete config.planningReasoningBudget;
        }
        if (implementationReasoningBudget) {
          config.implementationReasoningBudget = implementationReasoningBudget;
        } else {
          delete config.implementationReasoningBudget;
        }
        if (validationReasoningBudget) {
          config.validationReasoningBudget = validationReasoningBudget;
        } else {
          delete config.validationReasoningBudget;
        }

        try {
          await updateConnection.mutateAsync({
            id: data.connectionId!,
            data: {
              name: data.name,
              config,
            },
          });
          showToast.success(t("connectionUpdated"));
          form.reset(DEFAULT_FORM_VALUES);
          setProviderLocked(false);
          setEditingConnectionConfig(null);
          setDialogOpen(false);
        } catch {
          showToast.error(t("updateFailed"));
        }
        return;
      }

      // Build credentials blob (matches backend expectations)
      const credentials: Record<string, unknown> = {
        apiKey: data.apiKey,
      };
      if (data.provider === "anthropic" && authMethod) {
        credentials.authMethod = authMethod;
      }
      if (baseUrl) {
        credentials.baseUrl = baseUrl;
      }

      // Build config (non-secret metadata)
      const config: Record<string, unknown> = {};
      if (data.provider === "anthropic" && authMethod) {
        config.authMethod = authMethod;
      }
      if (baseUrl) {
        config.baseUrl = baseUrl;
      }
      if (data.provider === "zai") {
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

      // Step 1: Test credentials BEFORE creating the connection
      setIsTesting(true);
      try {
        const testResult = await testCredentials.mutateAsync({
          provider: data.provider,
          credentials,
          config: Object.keys(config).length > 0 ? config : undefined,
        });

        if (!testResult.valid) {
          setTestError(
            testResult.error ??
              "API key verification failed. Please check your credentials.",
          );
          setIsTesting(false);
          return; // Do NOT create connection
        }
      } catch {
        setTestError("Could not verify credentials. Please try again.");
        setIsTesting(false);
        return; // Do NOT create connection
      }
      setIsTesting(false);

      // Step 2: Test passed — create the connection
      try {
        await createConnection.mutateAsync({
          provider: data.provider,
          category: PROVIDER_CATEGORY[data.provider],
          scope: activeScope,
          name: data.name,
          accountIdentifier: `${String(data.apiKey).slice(0, 7)}...`,
          credentials,
          config,
        });

        showToast.success(t("connectionCreated"));
        form.reset(DEFAULT_FORM_VALUES);
        setProviderLocked(false);
        setDialogOpen(false);
      } catch {
        showToast.error(t("connectionFailed"));
      }
    },
    [activeScope, createConnection, editingConnectionConfig, form, testCredentials, updateConnection, t],
  );

  const availableModels = useMemo(
    () => getModelsForProvider(selectedProvider),
    [selectedProvider],
  );

  return {
    form,
    dialogOpen,
    setDialogOpen: handleOpenChange,
    onSubmit,
    isSubmitting: createConnection.isPending || updateConnection.isPending,
    isFormValid,
    selectedProvider,
    isTesting,
    testError,
    isEditing,
    providerLocked,
    openForProvider,
    availableModels,
  };
};

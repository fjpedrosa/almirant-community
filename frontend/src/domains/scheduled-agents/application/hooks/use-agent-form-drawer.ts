"use client";

import { useEffect, useMemo, useCallback, useRef, useState } from "react";
import { useForm, useWatch } from "react-hook-form";
import { useQuery } from "@tanstack/react-query";
import { shouldResetAgentForm } from "./should-reset-agent-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import type {
  ScheduledAgentConfig,
  CreateScheduledAgentData,
  UpdateScheduledAgentData,
  TimeWindowConfig,
  CronConfig,
  CodingAgent,
  AIProvider,
  AgentProvider,
  BacklogDrainPreviewResult,
  AgentKind,
  AutomationTargetKind,
  BuiltinAutomationId,
  UserSkillOption,
  ScheduledAgentMcpServers,
  ScheduledAgentWebhookProposal,
  TargetConfig,
  ProjectOption,
} from "../../domain/types";
import {
  isTimeWindowConfig,
  getAiProvidersForScheduledRuntime,
  MODELS_BY_PROVIDER,
  REASONING_LEVEL_OPTIONS_ANTHROPIC,
  REASONING_LEVEL_OPTIONS_CODEX,
  REASONING_LEVEL_OPTIONS_ZAI,
  normalizeScheduledCodingAgent,
} from "../../domain/types";
import type { SkillSelectorItem } from "@/domains/skills/domain/types";
import { resolveDefaultCronExpression } from "../../presentation/components/cron-form-defaults";
import { scheduledAgentsApi } from "@/lib/api/client";
import {
  resolveCanonicalModelId,
  reconcileModelWithAvailable,
} from "@/lib/ai-models-catalog";

// Extended schema with 5 new optional fields
export const scheduledAgentFormSchema = z
  .object({
    name: z.string().min(1, "Name is required").max(255),
    projectId: z.string().optional(),
    prompt: z.string().optional(),
    jobType: z.enum(["implementation", "planning", "review", "validation", "bug-fix", "recording", "prewarm", "scheduled", "integration"]).default("scheduled"),
    provider: z.enum(["claude-code", "codex", "zipu", "grok"]),
    trigger: z.enum(["scheduled", "webhook"]).default("scheduled"),
    webhookId: z.string().optional(),
    webhookToken: z.string().optional(),
    webhookUrl: z.string().optional(),
    testWebhookUrl: z.string().optional(),
    skillId: z.string().nullable().optional(),
    scheduleType: z.enum(["manual", "time_window", "cron"]),
    // Time window fields
    startHour: z.coerce.number().min(0).max(23).optional(),
    endHour: z.coerce.number().min(0).max(23).optional(),
    daysOfWeek: z.array(z.number().min(0).max(6)).optional(),
    // Cron fields
    cronExpression: z.string().optional(),
    timezone: z.string().min(1),
    enabled: z.boolean(),
    maxJobsPerRun: z.coerce.number().min(1).max(100),
    // New optional fields (types will be added to ScheduledAgentConfig in A-1481)
    description: z.string().max(1000).optional(),
    codingAgent: z.enum(["claude-code", "codex", "opencode"]).optional(),
    aiProvider: z.string().optional(),
    aiModel: z.string().optional(),
    reasoningLevel: z.string().optional(),
    mcpServersJson: z.string().max(20000, "MCP config is too large").optional(),
    // Wizard discriminators (frontend-only — derived from persisted shape)
    agentKind: z.enum(["repository", "automation"]).default("repository"),
    automationTargetKind: z.enum(["builtin", "user-skill"]).default("builtin"),
    builtinAutomationId: z.enum(["backlog-drain", "dod-remediation", "dod-review", "release-integration"]).default("backlog-drain"),
    automationSkillSlug: z.string().optional(),
    automationProjectIds: z.array(z.string()).default([]),
    automationQuietPeriodMinutes: z.coerce.number().min(0).max(1440).default(15),
    backlogDrainEnabled: z.boolean().default(false),
    backlogDrainProjectIds: z.array(z.string()).default([]),
    backlogDrainDefaultMaxConcurrentJobs: z.coerce.number().min(1).max(100).default(1),
    backlogDrainProjectConcurrency: z.record(z.string(), z.coerce.number().min(1).max(100)).default({}),
    backlogDrainExcludedWorkItemIds: z.array(z.string()).default([]),
    backlogDrainExcludeDescendants: z.boolean().default(true),
  })
  .refine(
    (data) => {
      if (data.scheduleType === "time_window") {
        return (
          data.startHour !== undefined &&
          data.endHour !== undefined &&
          data.daysOfWeek !== undefined &&
          data.daysOfWeek.length > 0
        );
      }
      return true;
    },
    {
      message: "Time window requires start hour, end hour, and at least one day",
      path: ["daysOfWeek"],
    }
  )
  .refine(
    (data) => {
      const trimmed = data.mcpServersJson?.trim();
      if (!trimmed) return true;
      try {
        const parsed = JSON.parse(trimmed);
        return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed);
      } catch {
        return false;
      }
    },
    {
      message: "MCP servers must be a valid JSON object",
      path: ["mcpServersJson"],
    }
  )
  .refine(
    (data) => {
      if (data.agentKind === "automation" && data.automationTargetKind === "user-skill") {
        return Boolean(data.automationSkillSlug);
      }
      return true;
    },
    {
      message: "Pick a skill for this automation",
      path: ["automationSkillSlug"],
    }
  )
  .refine(
    (data) => {
      if (data.scheduleType === "cron") {
        return data.cronExpression && data.cronExpression.length > 0;
      }
      return true;
    },
    {
      message: "Cron expression is required",
      path: ["cronExpression"],
    }
  )
  .refine(
    (data) => {
      if (data.trigger === "webhook") {
        return Boolean(data.webhookId && data.webhookToken && data.webhookUrl && data.testWebhookUrl);
      }
      return true;
    },
    {
      message: "Webhook URL proposal is required",
      path: ["webhookUrl"],
    }
  );

export type FormValues = z.infer<typeof scheduledAgentFormSchema>;

const isBacklogQueueAutomationId = (
  builtinAutomationId: BuiltinAutomationId,
): builtinAutomationId is "backlog-drain" | "dod-remediation" => {
  return builtinAutomationId === "backlog-drain" || builtinAutomationId === "dod-remediation";
};

export const resolveScheduledAgentSubmitJobType = (
  values: Pick<FormValues, "agentKind" | "automationTargetKind" | "builtinAutomationId" | "jobType">,
): FormValues["jobType"] => {
  if (values.agentKind === "automation" && values.automationTargetKind === "builtin") {
    if (values.builtinAutomationId === "dod-review") return "review";
    if (values.builtinAutomationId === "release-integration") return "integration";
    return "implementation";
  }
  if (values.agentKind === "automation" && values.automationTargetKind === "user-skill") {
    return "scheduled";
  }
  return values.jobType;
};

export const resolveScheduledAgentSubmitProvider = (
  values: Pick<FormValues, "agentKind" | "automationTargetKind" | "builtinAutomationId" | "provider" | "codingAgent" | "aiProvider">,
): FormValues["provider"] => {
  const isBuiltinAutomation =
    values.agentKind === "automation" &&
    values.automationTargetKind === "builtin";

  if (!isBuiltinAutomation) return values.provider;

  // For all builtin automations the legacy `provider` AgentProvider value is
  // derived from the (codingAgent, aiProvider) pair the user picked. The
  // runner reads `codingAgent` and `aiProvider` directly, so this is purely
  // for backwards compatibility with consumers still reading `provider`.
  // dod-review and release-integration need the same derivation to avoid
  // provider/aiProvider mismatch validation errors in the backend.
  switch (values.aiProvider) {
    case "anthropic":
      return "claude-code";
    case "openai":
      return "codex";
    case "zai":
      return "zipu";
    case "xai":
      return "grok";
  }

  // Fall back to the coding-agent default when aiProvider is missing.
  if (values.codingAgent === "codex") return "codex";
  if (values.codingAgent === "opencode") return "zipu";
  return "claude-code";
};

export const resolveScheduledAgentSubmitProjectId = (
  values: Pick<FormValues, "agentKind" | "automationTargetKind" | "projectId">,
): string | null => {
  const isBuiltinAutomation =
    values.agentKind === "automation" && values.automationTargetKind === "builtin";

  return isBuiltinAutomation ? null : values.projectId || null;
};

const resolveProjectIdsScope = (projectIds: string[]): string[] | undefined => {
  const uniqueProjectIds = Array.from(new Set(projectIds.filter(Boolean)));
  return uniqueProjectIds.length > 0 ? uniqueProjectIds : undefined;
};

export const buildBuiltinAutomationTargetConfig = (
  values: Pick<
    FormValues,
    | "builtinAutomationId"
    | "automationProjectIds"
    | "automationQuietPeriodMinutes"
    | "backlogDrainDefaultMaxConcurrentJobs"
    | "backlogDrainProjectIds"
    | "backlogDrainProjectConcurrency"
    | "backlogDrainExcludedWorkItemIds"
    | "backlogDrainExcludeDescendants"
    | "projectId"
  > & { allProjectIds?: string[] },
): TargetConfig => {
  // Empty automationProjectIds means "all projects" — persist as empty so the
  // backend's resolveBacklogStyleRules treats it as allProjects=true. Do NOT
  // expand to the current project list, otherwise the choice is lost on reload
  // (the form would read back N explicit projects instead of "all"). Also do
  // NOT fall back to backlogDrainProjectIds: that legacy mirror was repopulated
  // when the user touched the backlog-drain UI and would silently turn an
  // intended "all projects" save on dod-review / release-integration into
  // whatever stale list backlogDrainProjectIds happened to hold.
  const automationProjectIds = resolveProjectIdsScope(values.automationProjectIds) ?? [];
  const projectQueueConfig = {
    enabled: true,
    minAgeMinutes: values.automationQuietPeriodMinutes,
    defaultMaxConcurrentJobs: values.backlogDrainDefaultMaxConcurrentJobs,
    projects: automationProjectIds.map((projectId) => ({
      projectId,
      enabled: true,
      maxConcurrentJobs: values.backlogDrainProjectConcurrency[projectId] ?? values.backlogDrainDefaultMaxConcurrentJobs,
    })),
  };

  if (values.builtinAutomationId === "dod-review") {
    return {
      projectIds: resolveProjectIdsScope(values.automationProjectIds),
      dodReview: projectQueueConfig,
    };
  }

  if (values.builtinAutomationId === "release-integration") {
    return {
      projectIds: resolveProjectIdsScope(values.automationProjectIds),
      releaseIntegration: projectQueueConfig,
    };
  }

  const backlogStyleConfig = {
    enabled: true,
    minAgeMinutes: values.automationQuietPeriodMinutes,
    defaultMaxConcurrentJobs: values.backlogDrainDefaultMaxConcurrentJobs,
    projects: automationProjectIds.map((projectId) => ({
      projectId,
      enabled: true,
      maxConcurrentJobs: values.backlogDrainProjectConcurrency[projectId] ?? values.backlogDrainDefaultMaxConcurrentJobs,
      excludedWorkItemIds: values.backlogDrainExcludedWorkItemIds,
      excludeDescendants: values.backlogDrainExcludeDescendants,
    })),
  };

  if (values.builtinAutomationId === "dod-remediation") {
    return {
      dodRemediation: backlogStyleConfig,
    };
  }

  return {
    backlogDrain: backlogStyleConfig,
  };
};

export const resolveScheduledAgentSubmitRuntimeFields = (
  values: Pick<FormValues, "codingAgent" | "aiProvider" | "aiModel" | "reasoningLevel">,
): Pick<CreateScheduledAgentData, "codingAgent" | "aiProvider" | "aiModel" | "reasoningLevel"> => {
  return {
    codingAgent: values.codingAgent || undefined,
    aiProvider: values.aiProvider || undefined,
    aiModel: values.aiModel || undefined,
    reasoningLevel: values.reasoningLevel || undefined,
  };
};

export interface SkillItem {
  slug: string;
  name: string;
  description: string | null;
}

interface UseAgentFormDrawerParams {
  open: boolean;
  config: ScheduledAgentConfig | null;
  onSubmit: (data: CreateScheduledAgentData | UpdateScheduledAgentData) => void;
  skills: SkillSelectorItem[];
  projects: ProjectOption[];
}

const SLASH_SKILL_PROMPT_REGEX = /^\/([a-zA-Z0-9_-]+)\s*$/;

const formatMcpServersJson = (
  mcpServers: ScheduledAgentMcpServers | null | undefined,
): string => {
  if (!mcpServers || Object.keys(mcpServers).length === 0) {
    return "";
  }

  return JSON.stringify(mcpServers, null, 2);
};

const parseMcpServersJson = (
  value: string | undefined,
): ScheduledAgentMcpServers | null => {
  const trimmed = value?.trim();
  if (!trimmed) {
    return null;
  }

  return JSON.parse(trimmed) as ScheduledAgentMcpServers;
};

const inferAutomationTargetFromConfig = (
  config: ScheduledAgentConfig,
  knownSkillSlugs: Set<string>,
): {
  agentKind: AgentKind;
  automationTargetKind: AutomationTargetKind;
  builtinAutomationId: BuiltinAutomationId;
  automationSkillSlug: string | undefined;
} => {
  if (config.targetConfig?.backlogDrain?.enabled === true) {
    return { agentKind: "automation", automationTargetKind: "builtin", builtinAutomationId: "backlog-drain", automationSkillSlug: undefined };
  }
  if (config.targetConfig?.dodRemediation?.enabled === true) {
    return { agentKind: "automation", automationTargetKind: "builtin", builtinAutomationId: "dod-remediation", automationSkillSlug: undefined };
  }
  if (config.targetConfig?.dodReview?.enabled === true) {
    return { agentKind: "automation", automationTargetKind: "builtin", builtinAutomationId: "dod-review", automationSkillSlug: undefined };
  }
  if (config.targetConfig?.releaseIntegration?.enabled === true) {
    return { agentKind: "automation", automationTargetKind: "builtin", builtinAutomationId: "release-integration", automationSkillSlug: undefined };
  }
  const trimmedPrompt = (config.prompt ?? "").trim();
  const slashMatch = SLASH_SKILL_PROMPT_REGEX.exec(trimmedPrompt);
  if (slashMatch && knownSkillSlugs.has(slashMatch[1])) {
    return { agentKind: "automation", automationTargetKind: "user-skill", builtinAutomationId: "backlog-drain", automationSkillSlug: slashMatch[1] };
  }
  return { agentKind: "repository", automationTargetKind: "builtin", builtinAutomationId: "backlog-drain", automationSkillSlug: undefined };
};

export const useAgentFormDrawer = ({
  open,
  config,
  onSubmit,
  skills,
  projects,
}: UseAgentFormDrawerParams) => {
  const isEditing = config !== null;

  const knownSkillSlugs = useMemo(
    () => new Set(skills.map((s) => s.slug ?? s.name).filter(Boolean) as string[]),
    [skills],
  );

  const getDefaultValues = useCallback((): FormValues => {
    if (config) {
      const isTimeWindow = isTimeWindowConfig(config.scheduleConfig);
      const timeConfig = isTimeWindow
        ? (config.scheduleConfig as TimeWindowConfig)
        : null;
      const cronConfig = config.scheduleType === "cron" && config.scheduleConfig
        ? (config.scheduleConfig as CronConfig)
        : null;

      const inferred = inferAutomationTargetFromConfig(config, knownSkillSlugs);
      const backlogStyleTarget = config.targetConfig?.backlogDrain ?? config.targetConfig?.dodRemediation;
      const projectQueueTarget =
        backlogStyleTarget ??
        config.targetConfig?.dodReview ??
        config.targetConfig?.releaseIntegration;
      const projectQueueProjectIds =
        projectQueueTarget?.projects?.map((rule) => rule.projectId) ??
        config.targetConfig?.projectIds ??
        (config.projectId ? [config.projectId] : []);

      return {
        name: config.name,
        projectId: config.projectId ?? "",
        prompt: config.prompt ?? "",
        jobType: config.jobType,
        provider: config.provider,
        trigger: config.trigger ?? "scheduled",
        webhookId: config.id,
        webhookToken: config.webhookToken ?? undefined,
        webhookUrl: "",
        testWebhookUrl: "",
        skillId: config.skillId ?? null,
        scheduleType: config.scheduleType,
        startHour: timeConfig?.startHour,
        endHour: timeConfig?.endHour,
        daysOfWeek: timeConfig?.daysOfWeek ?? [],
        cronExpression: cronConfig?.expression ?? "",
        timezone: config.timezone,
        enabled: config.enabled,
        maxJobsPerRun: config.maxJobsPerRun,
        description: config.description ?? "",
        codingAgent: normalizeScheduledCodingAgent(config.codingAgent) ?? "claude-code",
        aiProvider: config.aiProvider ?? "",
        // Canonicalize the persisted model so a value stored with the wrong
        // casing (e.g. "GLM-5.2") or as a dated snapshot still matches a Select
        // option; fall back to the raw value rather than dropping it.
        aiModel: resolveCanonicalModelId(config.aiModel) ?? config.aiModel ?? "",
        reasoningLevel: (config.reasoningLevel as FormValues["reasoningLevel"]) ?? undefined,
        mcpServersJson: formatMcpServersJson(config.mcpServers),
        agentKind: inferred.agentKind,
        automationTargetKind: inferred.automationTargetKind,
        builtinAutomationId: inferred.builtinAutomationId,
        automationSkillSlug: inferred.automationSkillSlug,
        automationProjectIds:
          projectQueueProjectIds.length > 0
            ? projectQueueProjectIds
            : config.targetConfig?.projectIds ??
              (inferred.automationTargetKind === "builtin" && config.projectId
                ? [config.projectId]
                : []),
        automationQuietPeriodMinutes: projectQueueTarget?.minAgeMinutes ?? 15,
        backlogDrainEnabled: config.targetConfig?.backlogDrain?.enabled === true || config.targetConfig?.dodRemediation?.enabled === true,
        backlogDrainProjectIds: projectQueueProjectIds,
        backlogDrainDefaultMaxConcurrentJobs: projectQueueTarget?.defaultMaxConcurrentJobs ?? 1,
        backlogDrainProjectConcurrency: Object.fromEntries(
          (projectQueueTarget?.projects ?? []).map((rule) => [
            rule.projectId,
            rule.maxConcurrentJobs ?? projectQueueTarget?.defaultMaxConcurrentJobs ?? 1,
          ]),
        ),
        backlogDrainExcludedWorkItemIds: Array.from(new Set((backlogStyleTarget?.projects ?? []).flatMap((rule) => rule.excludedWorkItemIds ?? []))),
        backlogDrainExcludeDescendants: (backlogStyleTarget?.projects ?? []).every((rule) => rule.excludeDescendants !== false),
      };
    }
    return {
      name: "",
      projectId: "",
      prompt: "",
      jobType: "scheduled",
      provider: "claude-code",
      trigger: "scheduled",
      webhookId: undefined,
      webhookToken: undefined,
      webhookUrl: "",
      testWebhookUrl: "",
      skillId: null,
      scheduleType: "manual",
      startHour: 9,
      endHour: 18,
      daysOfWeek: [1, 2, 3, 4, 5],
      cronExpression: "",
      timezone: "Europe/Madrid",
      enabled: false,
      maxJobsPerRun: 10,
      description: "",
      codingAgent: "claude-code",
      aiProvider: "anthropic",
      aiModel: "",
      reasoningLevel: undefined,
      mcpServersJson: "",
      agentKind: "repository",
      automationTargetKind: "builtin",
      builtinAutomationId: "backlog-drain",
      automationSkillSlug: undefined,
      automationProjectIds: [],
      automationQuietPeriodMinutes: 15,
      backlogDrainEnabled: false,
      backlogDrainProjectIds: [],
      backlogDrainDefaultMaxConcurrentJobs: 1,
      backlogDrainProjectConcurrency: {},
      backlogDrainExcludedWorkItemIds: [],
      backlogDrainExcludeDescendants: true,
    };
  }, [config, knownSkillSlugs]);

  const form = useForm<FormValues>({
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    resolver: zodResolver(scheduledAgentFormSchema) as any,
    defaultValues: getDefaultValues(),
  });
  const [webhookProposal, setWebhookProposal] =
    useState<ScheduledAgentWebhookProposal | null>(null);
  const [isLoadingWebhookProposal, setIsLoadingWebhookProposal] = useState(false);
  const webhookProposalRequestKeyRef = useRef<string | null>(null);

  // Reset the form only on the closed -> open transition or when the edited
  // config id actually changes. Avoid resetting on every config reference
  // change (e.g. React Query refetch returning a new object identity for the
  // same record), which would wipe user-typed values mid-edit.
  const configId = config?.id ?? null;
  const prevOpenRef = useRef<boolean>(open);
  const prevConfigIdRef = useRef<string | null>(configId);
  useEffect(() => {
    const prevOpen = prevOpenRef.current;
    const prevConfigId = prevConfigIdRef.current;
    prevOpenRef.current = open;
    prevConfigIdRef.current = configId;
    if (
      shouldResetAgentForm({
        prevOpen,
        nextOpen: open,
        prevConfigId,
        nextConfigId: configId,
      })
    ) {
      form.reset(getDefaultValues());
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, configId]);

  const scheduleType = useWatch({ control: form.control, name: "scheduleType" });
  const trigger = (useWatch({ control: form.control, name: "trigger" }) ?? "scheduled") as
    | "scheduled"
    | "webhook";
  const watchedWebhookId = useWatch({ control: form.control, name: "webhookId" }) as
    | string
    | undefined;
  const watchedWebhookToken = useWatch({ control: form.control, name: "webhookToken" }) as
    | string
    | undefined;
  const watchedProvider = useWatch({ control: form.control, name: "provider" }) as
    | AgentProvider
    | undefined;
  const watchedCodingAgent = useWatch({ control: form.control, name: "codingAgent" }) as
    | CodingAgent
    | undefined;
  const watchedAiProvider = useWatch({ control: form.control, name: "aiProvider" }) as
    | AIProvider
    | undefined;
  const agentKind = useWatch({ control: form.control, name: "agentKind" }) as AgentKind;
  const automationTargetKind = useWatch({ control: form.control, name: "automationTargetKind" }) as AutomationTargetKind;
  const builtinAutomationId = useWatch({ control: form.control, name: "builtinAutomationId" }) as BuiltinAutomationId;
  const automationSkillSlug = (useWatch({ control: form.control, name: "automationSkillSlug" }) as string | undefined) ?? null;
  const automationProjectIds = useWatch({ control: form.control, name: "automationProjectIds" }) as string[];
  const backlogDrainEnabled = agentKind === "automation" && automationTargetKind === "builtin" && isBacklogQueueAutomationId(builtinAutomationId);
  const automationQuietPeriodMinutes = useWatch({ control: form.control, name: "automationQuietPeriodMinutes" }) as number;
  const backlogDrainDefaultMaxConcurrentJobs = useWatch({ control: form.control, name: "backlogDrainDefaultMaxConcurrentJobs" }) as number;
  const backlogDrainProjectConcurrency = useWatch({ control: form.control, name: "backlogDrainProjectConcurrency" }) as Record<string, number>;
  const backlogDrainExcludedWorkItemIds = useWatch({ control: form.control, name: "backlogDrainExcludedWorkItemIds" }) as string[];
  const backlogDrainExcludeDescendants = useWatch({ control: form.control, name: "backlogDrainExcludeDescendants" }) as boolean;

  // Cascading: available providers filtered by coding agent
  const availableProviders = useMemo(() => {
    return getAiProvidersForScheduledRuntime(watchedProvider, watchedCodingAgent);
  }, [watchedProvider, watchedCodingAgent]);

  // Cascading: available models filtered by provider
  const availableModels = useMemo(() => {
    if (!watchedAiProvider || !(watchedAiProvider in MODELS_BY_PROVIDER)) return [];
    return MODELS_BY_PROVIDER[watchedAiProvider];
  }, [watchedAiProvider]);

  // Reasoning options vary by runtime, not just by API provider.
  const availableReasoningLevels = useMemo(() => {
    if (watchedCodingAgent === "claude-code") return REASONING_LEVEL_OPTIONS_ANTHROPIC;
    if (watchedCodingAgent === "codex") return REASONING_LEVEL_OPTIONS_CODEX;
    if (watchedAiProvider === "zai" || watchedAiProvider === "xai") return REASONING_LEVEL_OPTIONS_ZAI;
    return REASONING_LEVEL_OPTIONS_CODEX;
  }, [watchedAiProvider, watchedCodingAgent]);

  // Auto-select when only 1 option available, reset when parent changes
  useEffect(() => {
    if (!open) return;
    if (isEditing) return;
    if (scheduleType === "manual" && form.getValues("enabled")) {
      form.setValue("enabled", false);
    }
  }, [isEditing, open, scheduleType, form]);

  useEffect(() => {
    if (!open) {
      webhookProposalRequestKeyRef.current = null;
      setWebhookProposal(null);
      setIsLoadingWebhookProposal(false);
      return;
    }

    if (trigger !== "webhook") return;

    const requestId = config?.id ?? watchedWebhookId;
    const requestToken = watchedWebhookToken ?? config?.webhookToken ?? undefined;
    const requestKey = `${requestId ?? "new"}:${requestToken ?? "new"}`;
    if (webhookProposalRequestKeyRef.current === requestKey) return;

    webhookProposalRequestKeyRef.current = requestKey;
    setIsLoadingWebhookProposal(true);

    let cancelled = false;
    scheduledAgentsApi.proposeWebhook({
      ...(requestId ? { id: requestId } : {}),
      ...(requestToken ? { webhookToken: requestToken } : {}),
    })
      .then((proposal) => {
        if (cancelled) return;
        setWebhookProposal(proposal);
        webhookProposalRequestKeyRef.current = `${proposal.id}:${proposal.webhookToken}`;
        form.setValue("webhookId", proposal.id, { shouldDirty: false });
        form.setValue("webhookToken", proposal.webhookToken, { shouldDirty: false });
        form.setValue("webhookUrl", proposal.webhookUrl, { shouldDirty: false });
        form.setValue("testWebhookUrl", proposal.testWebhookUrl, { shouldDirty: false });
      })
      .catch(() => {
        if (!cancelled) setWebhookProposal(null);
      })
      .finally(() => {
        if (!cancelled) setIsLoadingWebhookProposal(false);
      });

    return () => {
      cancelled = true;
    };
  }, [
    open,
    trigger,
    watchedWebhookId,
    watchedWebhookToken,
    config?.id,
    config?.webhookToken,
    form,
  ]);

  useEffect(() => {
    if (!open) return;

    const currentCronExpression = form.getValues("cronExpression");
    const nextCronExpression = resolveDefaultCronExpression({
      scheduleType,
      cronExpression: currentCronExpression,
    });

    if (nextCronExpression && nextCronExpression !== currentCronExpression) {
      form.setValue("cronExpression", nextCronExpression);
    }
  }, [open, scheduleType, form]);

  useEffect(() => {
    if (!open) return;
    if (availableProviders.length === 1) {
      const current = form.getValues("aiProvider");
      if (current !== availableProviders[0]) {
        form.setValue("aiProvider", availableProviders[0]);
      }
    } else if (
      availableProviders.length > 0 &&
      watchedAiProvider &&
      !availableProviders.includes(watchedAiProvider)
    ) {
      form.setValue("aiProvider", "");
      form.setValue("aiModel", "");
    }
  }, [availableProviders, open, form, watchedAiProvider]);

  useEffect(() => {
    if (!open) return;
    if (availableModels.length === 0) return;
    if (!watchedAiProvider) return;
    const current = form.getValues("aiModel");
    if (!current) return;
    // Reconcile against the provider's options: canonicalize case/snapshot
    // mismatches instead of wiping a valid value; only clear when the model
    // truly does not belong to the selected provider.
    const next = reconcileModelWithAvailable(
      current,
      availableModels.map((m) => m.value),
    );
    if (next !== current) {
      form.setValue("aiModel", next);
    }
  }, [availableModels, open, form, watchedAiProvider]);

  useEffect(() => {
    if (!open) return;
    const current = form.getValues("reasoningLevel");
    if (current && !availableReasoningLevels.some((option) => option.value === current)) {
      form.setValue("reasoningLevel", undefined);
    }
  }, [availableReasoningLevels, open, form]);

  const selectedBacklogDrainProjectIds = useMemo(() => {
    if (automationProjectIds.length > 0) return automationProjectIds;
    const projectId = form.getValues("projectId");
    return projectId ? [projectId] : [];
  }, [automationProjectIds, form]);

  const buildBacklogDrainTargetConfig = useCallback(() => {
    const selectedProjectIds = selectedBacklogDrainProjectIds;
    const backlogStyleConfig = {
      enabled: backlogDrainEnabled,
      minAgeMinutes: automationQuietPeriodMinutes,
      defaultMaxConcurrentJobs: backlogDrainDefaultMaxConcurrentJobs,
      projects: selectedProjectIds.map((projectId) => ({
        projectId,
        enabled: true,
        maxConcurrentJobs: backlogDrainProjectConcurrency[projectId] ?? backlogDrainDefaultMaxConcurrentJobs,
        excludedWorkItemIds: backlogDrainExcludedWorkItemIds,
        excludeDescendants: backlogDrainExcludeDescendants,
      })),
    };
    return {
      [builtinAutomationId === "dod-remediation" ? "dodRemediation" : "backlogDrain"]: backlogStyleConfig,
    };
  }, [
    backlogDrainDefaultMaxConcurrentJobs,
    backlogDrainEnabled,
    backlogDrainExcludeDescendants,
    backlogDrainExcludedWorkItemIds,
    backlogDrainProjectConcurrency,
    automationQuietPeriodMinutes,
    builtinAutomationId,
    selectedBacklogDrainProjectIds,
  ]);

  const backlogDrainWorkItemsQuery = useQuery({
    queryKey: ["scheduled-agents", "backlog-drain-work-items", selectedBacklogDrainProjectIds],
    queryFn: () => scheduledAgentsApi.listBacklogDrainWorkItems(selectedBacklogDrainProjectIds),
    enabled: open && backlogDrainEnabled && selectedBacklogDrainProjectIds.length > 0,
  });

  const backlogDrainPreviewQuery = useQuery<BacklogDrainPreviewResult>({
    queryKey: [
      "scheduled-agents",
      "backlog-drain-preview",
      selectedBacklogDrainProjectIds,
      backlogDrainProjectConcurrency,
      backlogDrainExcludedWorkItemIds,
      backlogDrainExcludeDescendants,
      builtinAutomationId,
      automationQuietPeriodMinutes,
      watchedCodingAgent,
      watchedAiProvider,
      form.getValues("aiModel"),
      form.getValues("reasoningLevel"),
    ],
    queryFn: () => scheduledAgentsApi.previewBacklogDrain({
      projectId: form.getValues("projectId") || null,
      targetConfig: buildBacklogDrainTargetConfig(),
      codingAgent: watchedCodingAgent ?? null,
      aiProvider: watchedAiProvider ?? null,
      aiModel: form.getValues("aiModel") || null,
      reasoningLevel: form.getValues("reasoningLevel") || null,
    }),
    enabled: open && backlogDrainEnabled && selectedBacklogDrainProjectIds.length > 0,
  });

  const flatSkills = useMemo((): SkillItem[] => {
    return skills.map((s) => ({
      slug: s.slug ?? s.name,
      name: s.name,
      description: s.description ?? null,
    }));
  }, [skills]);

  const userSkills = useMemo((): UserSkillOption[] => {
    return skills.map((s) => ({
      slug: s.slug ?? s.name,
      name: s.name,
      description: s.description ?? null,
      source: s.source,
    }));
  }, [skills]);

  const handleSubmit = form.handleSubmit((values) => {
    const scheduleConfig =
      values.scheduleType === "manual"
        ? null
        : values.scheduleType === "time_window"
          ? {
              startHour: values.startHour!,
              endHour: values.endHour!,
              daysOfWeek: values.daysOfWeek!,
            }
          : { expression: values.cronExpression! };

    const runtimeFields = resolveScheduledAgentSubmitRuntimeFields(values);
    const mcpServers = parseMcpServersJson(values.mcpServersJson);
    const isBuiltinAutomation =
      values.agentKind === "automation" && values.automationTargetKind === "builtin";
    const isUserSkillAutomation =
      values.agentKind === "automation" && values.automationTargetKind === "user-skill";

    const submittedPrompt = isBuiltinAutomation
      ? undefined
      : isUserSkillAutomation
        ? `/${values.automationSkillSlug}`
        : values.prompt || undefined;

    const isWebhookTrigger = values.trigger === "webhook";

    const data: CreateScheduledAgentData = {
      ...(!isEditing && isWebhookTrigger ? { id: values.webhookId } : {}),
      name: values.name,
      projectId: resolveScheduledAgentSubmitProjectId(values),
      prompt: submittedPrompt,
      jobType: resolveScheduledAgentSubmitJobType(values),
      provider: resolveScheduledAgentSubmitProvider(values),
      trigger: values.trigger,
      ...(isWebhookTrigger ? { webhookToken: values.webhookToken } : {}),
      skillId: values.skillId ?? null,
      scheduleType: isWebhookTrigger ? "manual" : values.scheduleType,
      ...(isWebhookTrigger
        ? { scheduleConfig: null }
        : scheduleConfig
          ? { scheduleConfig }
          : { scheduleConfig: null }),
      timezone: values.timezone,
      enabled: isWebhookTrigger || values.scheduleType === "manual" ? false : values.enabled,
      maxJobsPerRun: values.maxJobsPerRun,
      description: values.description || undefined,
      ...runtimeFields,
      mcpServers,
      targetConfig: isBuiltinAutomation
        ? buildBuiltinAutomationTargetConfig({
            ...values,
            allProjectIds: projects.map((project) => project.id),
          })
        : undefined,
    };

    onSubmit(data);
  });

  return {
    form,
    onSubmit: handleSubmit,
    skills: flatSkills,
    userSkills,
    scheduleType,
    trigger,
    isEditing,
    availableProviders,
    availableModels,
    availableReasoningLevels,
    agentKind,
    automationTargetKind,
    builtinAutomationId,
    automationSkillSlug,
    automationProjectIds,
    backlogDrainEnabled,
    backlogDrainProjectIds: selectedBacklogDrainProjectIds,
    backlogDrainWorkItems: backlogDrainWorkItemsQuery.data ?? [],
    isLoadingBacklogDrainWorkItems: backlogDrainWorkItemsQuery.isLoading,
    backlogDrainPreview: backlogDrainPreviewQuery.data ?? null,
    isLoadingBacklogDrainPreview: backlogDrainPreviewQuery.isLoading || backlogDrainPreviewQuery.isFetching,
    webhookProposal,
    isLoadingWebhookProposal,
  };
};

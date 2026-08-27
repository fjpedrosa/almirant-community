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
  AgentProvider,
  BacklogDrainPreviewResult,
  AgentKind,
  AutomationTargetKind,
  BuiltinAutomationId,
  UserSkillOption,
  ScheduledAgentWebhookProposal,
  TargetConfig,
  ProjectOption,
  AgentPlugin,
  AgentMcpServer,
} from "../../domain/types";
import {
  isTimeWindowConfig,
  isOnceConfig,
  getAiProvidersForScheduledRuntime,
  getModelsForScheduledRuntime,
  getScheduledReasoningLevelOptions,
  normalizeScheduledAiProvider,
  normalizeScheduledCodingAgent,
} from "../../domain/types";
import type { SkillSelectorItem } from "@/domains/skills/domain/types";
import { resolveDefaultCronExpression } from "../../presentation/components/cron-form-defaults";
import { scheduledAgentsApi } from "@/lib/api/client";
import { normalizeReasoningEffort } from "@/lib/ai-model-reasoning";
import {
  resolveRuntimeCapabilityAdmission,
  type RuntimeCapabilityAdmissionResult,
} from "@/domains/agents/domain/coding-agent-compatibility";
import {
  isZonedDateTimeInPast,
  isoToZonedDateTimeLocal,
  zonedDateTimeToIso,
} from "../../domain/once-schedule";

// Extended schema with 5 new optional fields
export const scheduledAgentFormSchema = z
  .object({
    name: z.string().min(1, "Name is required").max(255),
    projectId: z.string().optional(),
    prompt: z.string().optional(),
    jobType: z.enum(["implementation", "planning", "review", "validation", "bug-fix", "recording", "prewarm", "scheduled", "integration"]).default("scheduled"),
    provider: z.string().nullable().optional(),
    trigger: z.enum(["scheduled", "webhook"]).default("scheduled"),
    webhookId: z.string().optional(),
    webhookToken: z.string().optional(),
    webhookUrl: z.string().optional(),
    testWebhookUrl: z.string().optional(),
    skillId: z.string().nullable().optional(),
    scheduleType: z.enum(["manual", "time_window", "cron", "once"]),
    // Time window fields
    startHour: z.coerce.number().min(0).max(23).optional(),
    endHour: z.coerce.number().min(0).max(23).optional(),
    daysOfWeek: z.array(z.number().min(0).max(6)).optional(),
    // Cron fields
    cronExpression: z.string().optional(),
    // Once (run-once) field: a zone-naive `datetime-local` string (e.g.
    // "2026-08-15T14:30") representing a wall-clock moment in the `timezone`
    // field below. Converted to an absolute ISO runAt on submit — see
    // buildOnceScheduleConfig / domain/once-schedule.ts.
    onceRunAtLocal: z.string().optional(),
    timezone: z.string().min(1),
    enabled: z.boolean(),
    maxJobsPerRun: z.coerce.number().min(1).max(100),
    // New optional fields (types will be added to ScheduledAgentConfig in A-1481)
    description: z.string().max(1000).optional(),
    // Persisted edit values may come from a future or disabled runtime. Keep
    // raw strings in form state; generated projection options govern new selection.
    codingAgent: z.string().nullable().optional(),
    aiProvider: z.string().nullable().optional(),
    aiModel: z.string().nullable().optional(),
    reasoningLevel: z.string().nullable().optional(),
    // Agents v2 tooling selection (MCP servers + plugins picked from the
    // owner-aware catalog). The backend materializes managed selections at dispatch.
    needsBrowser: z.boolean().default(false),
    selectedPluginIds: z.array(z.string()).default([]),
    selectedMcpServerIds: z.array(z.string()).default([]),
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
      if (data.scheduleType === "once") {
        // A PAST runAt is intentionally allowed (the backend dispatches on
        // the next tick instead of rejecting it) — only an empty or
        // unparseable date/time blocks the form. See the "once" schedule
        // section in agent-form-drawer.tsx for the non-blocking past warning.
        if (!data.onceRunAtLocal) return false;
        return zonedDateTimeToIso(data.onceRunAtLocal, data.timezone) !== null;
      }
      return true;
    },
    {
      message: "Run once requires a valid date and time",
      path: ["onceRunAtLocal"],
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
): AgentProvider | null | undefined => {
  const isBuiltinAutomation =
    values.agentKind === "automation" &&
    values.automationTargetKind === "builtin";

  if (!isBuiltinAutomation) {
    return values.provider as AgentProvider | null | undefined;
  }
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

/**
 * Builds the persisted scheduleConfig for scheduleType='once' from the
 * form's zone-naive local date/time field. Returns null when no date/time
 * was picked or it doesn't parse — callers should treat that as "no
 * schedule config", matching the zod refine that blocks submission first.
 */
export const buildOnceScheduleConfig = (
  values: Pick<FormValues, "onceRunAtLocal" | "timezone">,
): { runAt: string } | null => {
  if (!values.onceRunAtLocal) return null;
  const runAt = zonedDateTimeToIso(values.onceRunAtLocal, values.timezone);
  return runAt ? { runAt } : null;
};

/**
 * Default value for the "once" date/time picker when editing an existing
 * config: converts the persisted absolute runAt back into the zone-naive
 * local wall-clock string, in the config's OWN timezone (not the browser's),
 * so editing shows exactly what the user originally picked.
 */
export const resolveOnceRunAtDefault = (
  config: Pick<ScheduledAgentConfig, "scheduleType" | "scheduleConfig" | "timezone"> | null,
): string => {
  if (!config || config.scheduleType !== "once" || !isOnceConfig(config.scheduleConfig)) {
    return "";
  }
  return isoToZonedDateTimeLocal(config.scheduleConfig.runAt, config.timezone) ?? "";
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

const SCHEDULED_RUNTIME_FIELD_NAMES = [
  "provider",
  "codingAgent",
  "aiProvider",
  "aiModel",
  "reasoningLevel",
] as const;

type ScheduledRuntimeDirtyFields = Partial<
  Record<(typeof SCHEDULED_RUNTIME_FIELD_NAMES)[number], boolean>
>;

export const hasScheduledAgentRuntimeFieldChanges = (
  dirtyFields: ScheduledRuntimeDirtyFields,
): boolean => SCHEDULED_RUNTIME_FIELD_NAMES.some((field) => dirtyFields[field] === true);

/** Preserve persisted runtime strings byte-for-byte at the edit boundary. */
export const resolveScheduledAgentRuntimeEditDefaults = (
  config: Pick<
    ScheduledAgentConfig,
    "provider" | "codingAgent" | "aiProvider" | "aiModel" | "reasoningLevel"
  >,
): Pick<FormValues, "provider" | "codingAgent" | "aiProvider" | "aiModel" | "reasoningLevel"> => ({
  provider: config.provider,
  codingAgent: config.codingAgent,
  aiProvider: config.aiProvider,
  aiModel: config.aiModel,
  reasoningLevel: config.reasoningLevel,
});

export const resolveScheduledAgentRuntimeAdmission = (
  values: Pick<
    FormValues,
    | "provider"
    | "codingAgent"
    | "aiProvider"
    | "aiModel"
    | "reasoningLevel"
    | "needsBrowser"
    | "selectedPluginIds"
    | "selectedMcpServerIds"
  >,
): RuntimeCapabilityAdmissionResult => {
  const capabilities = [
    ...(values.needsBrowser ? ["browser"] : []),
    ...(values.selectedPluginIds.length > 0 ? ["extensions"] : []),
    ...(values.selectedMcpServerIds.length > 0 ? ["mcp"] : []),
  ];

  const codingAgent =
    normalizeScheduledCodingAgent(values.codingAgent) ?? values.codingAgent ?? "";
  const aiProvider = values.aiProvider ?? "";
  // An omitted model retains runtime-default behavior for existing agents. Pi is
  // intentionally excluded: new Pi selections must name GLM-5.3 explicitly.
  // Resolve legacy defaults from admitted tuple-backed options so admission still
  // evaluates an exact model without forcing ordinary creates to persist one.
  const effectiveModel =
    values.aiModel ||
    (codingAgent === "pi"
      ? ""
      : getModelsForScheduledRuntime(codingAgent, aiProvider)[0]?.value) ||
    "";

  return resolveRuntimeCapabilityAdmission({
    codingAgent,
    aiProvider,
    model: effectiveModel,
    authClass: "api_key",
    capabilities,
  });
};

export const resolveScheduledAgentSubmitRuntimeFields = (
  values: Pick<FormValues, "provider" | "codingAgent" | "aiProvider" | "aiModel" | "reasoningLevel">,
  editState?: {
    isEditing: boolean;
    dirtyFields: ScheduledRuntimeDirtyFields;
  },
): Partial<Pick<CreateScheduledAgentData, "provider" | "codingAgent" | "aiProvider" | "aiModel" | "reasoningLevel">> => {
  if (
    editState?.isEditing &&
    !hasScheduledAgentRuntimeFieldChanges(editState.dirtyFields)
  ) {
    return {};
  }

  const selectedProvider = resolveScheduledAgentSubmitProvider({
    agentKind: "repository",
    automationTargetKind: "builtin",
    builtinAutomationId: "backlog-drain",
    ...values,
  });
  const provider =
    selectedProvider === "claude-code" ||
    selectedProvider === "codex" ||
    selectedProvider === "zipu" ||
    selectedProvider === "grok"
      ? selectedProvider
      : resolveScheduledAgentSubmitProvider({
          agentKind: "automation",
          automationTargetKind: "builtin",
          builtinAutomationId: "backlog-drain",
          ...values,
        });

  return {
    provider: provider ?? undefined,
    codingAgent: normalizeScheduledCodingAgent(values.codingAgent) ?? undefined,
    aiProvider: values.aiProvider || undefined,
    aiModel: values.aiModel || undefined,
    reasoningLevel: normalizeReasoningEffort({
      codingAgent: values.codingAgent,
      aiProvider: values.aiProvider,
      model: values.aiModel,
    }, values.reasoningLevel),
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
  plugins: AgentPlugin[];
  mcpServers: AgentMcpServer[];
}

const SLASH_SKILL_PROMPT_REGEX = /^\/([a-zA-Z0-9_-]+)\s*$/;

// Key under targetConfig.customFilters that persists this agent's Agents v2
// tooling selection (MCP servers + plugins picked from the owner-aware
// catalog). Frontend-only bookkeeping, same mechanism the pre-existing
// AgentKind classification above already relies on. Materializing a selected
// MCP server into a running job's actual mcpServers config (with its
// almirantServerId) happens server-side at dispatch, not here.
export const AGENT_TOOLING_SELECTION_KEY = "__agentTooling";

export interface AgentToolingSelection {
  selectedPluginIds: string[];
  selectedMcpServerIds: string[];
}

const UUID_RE = /^[0-9a-fA-F-]{36}$/;

const normalizeSelectedIds = (selectedIds: unknown): string[] => {
  if (!Array.isArray(selectedIds)) return [];

  const seen = new Set<string>();
  const result: string[] = [];
  for (const id of selectedIds) {
    if (typeof id !== "string") continue;
    const trimmed = id.trim();
    if (!UUID_RE.test(trimmed)) continue;
    if (seen.has(trimmed)) continue;
    seen.add(trimmed);
    result.push(trimmed);
  }
  return result;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

export const buildAgentToolingSelection = (
  values: Pick<FormValues, "selectedPluginIds" | "selectedMcpServerIds">,
): AgentToolingSelection => ({
  selectedPluginIds: normalizeSelectedIds(values.selectedPluginIds),
  selectedMcpServerIds: normalizeSelectedIds(values.selectedMcpServerIds),
});

export const mergeAgentToolingSelectionIntoTargetConfig = (
  targetConfig: TargetConfig | null | undefined,
  selection: AgentToolingSelection,
): TargetConfig => {
  const existing = targetConfig?.customFilters?.[AGENT_TOOLING_SELECTION_KEY];

  return {
    ...(targetConfig ?? {}),
    customFilters: {
      ...(targetConfig?.customFilters ?? {}),
      [AGENT_TOOLING_SELECTION_KEY]: {
        ...(isRecord(existing) ? existing : {}),
        ...selection,
      },
    },
  };
};

export const parseAgentToolingSelection = (
  targetConfig: TargetConfig | null | undefined,
): AgentToolingSelection => {
  const raw = targetConfig?.customFilters?.[AGENT_TOOLING_SELECTION_KEY];
  if (!isRecord(raw)) {
    return { selectedPluginIds: [], selectedMcpServerIds: [] };
  }

  return {
    selectedPluginIds: normalizeSelectedIds(raw.selectedPluginIds),
    selectedMcpServerIds: normalizeSelectedIds(raw.selectedMcpServerIds),
  };
};

export const AGENT_BROWSER_SELECTION_KEY = "__agent";

export const parseAgentBrowserSelection = (
  targetConfig: TargetConfig | null | undefined,
): boolean => {
  const raw = targetConfig?.customFilters?.[AGENT_BROWSER_SELECTION_KEY];
  return isRecord(raw) && raw.needsBrowser === true;
};

export const mergeAgentBrowserSelectionIntoTargetConfig = (
  targetConfig: TargetConfig | null | undefined,
  needsBrowser: boolean,
): TargetConfig => {
  const existing = targetConfig?.customFilters?.[AGENT_BROWSER_SELECTION_KEY];

  return {
    ...(targetConfig ?? {}),
    customFilters: {
      ...(targetConfig?.customFilters ?? {}),
      [AGENT_BROWSER_SELECTION_KEY]: {
        ...(isRecord(existing) ? existing : {}),
        needsBrowser,
      },
    },
  };
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
  plugins,
  mcpServers,
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
      const toolingSelection = parseAgentToolingSelection(config.targetConfig);
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
        onceRunAtLocal: resolveOnceRunAtDefault(config),
        timezone: config.timezone,
        enabled: config.enabled,
        maxJobsPerRun: config.maxJobsPerRun,
        description: config.description ?? "",
        ...resolveScheduledAgentRuntimeEditDefaults(config),
        needsBrowser: parseAgentBrowserSelection(config.targetConfig),
        selectedPluginIds: toolingSelection.selectedPluginIds,
        selectedMcpServerIds: toolingSelection.selectedMcpServerIds,
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
      onceRunAtLocal: "",
      timezone: "Europe/Madrid",
      enabled: false,
      maxJobsPerRun: 10,
      description: "",
      codingAgent: "claude-code",
      aiProvider: "anthropic",
      aiModel: "",
      reasoningLevel: undefined,
      needsBrowser: false,
      selectedPluginIds: [],
      selectedMcpServerIds: [],
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
    | string
    | null
    | undefined;
  const watchedCodingAgent = useWatch({ control: form.control, name: "codingAgent" }) as
    | string
    | null
    | undefined;
  const watchedAiProvider = useWatch({ control: form.control, name: "aiProvider" }) as
    | string
    | null
    | undefined;
  const watchedAiModel = useWatch({ control: form.control, name: "aiModel" }) as
    | string
    | undefined;
  const agentKind = useWatch({ control: form.control, name: "agentKind" }) as AgentKind;
  const selectedPluginIds =
    (useWatch({ control: form.control, name: "selectedPluginIds" }) as string[] | undefined) ?? [];
  const selectedMcpServerIds =
    (useWatch({ control: form.control, name: "selectedMcpServerIds" }) as string[] | undefined) ?? [];
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
  const watchedOnceRunAtLocal = (useWatch({ control: form.control, name: "onceRunAtLocal" }) as string | undefined) ?? "";
  const watchedTimezone = (useWatch({ control: form.control, name: "timezone" }) as string | undefined) ?? "UTC";

  // Non-blocking warning ("this will dispatch on the next tick") for a
  // 'once' runAt already in the past — the backend allows it, so this must
  // never fail form validation (see the zod refine above).
  const onceRunAtPastWarning = useMemo(
    () => scheduleType === "once" && isZonedDateTimeInPast(watchedOnceRunAtLocal, watchedTimezone),
    [scheduleType, watchedOnceRunAtLocal, watchedTimezone],
  );

  // Cascading: available providers filtered by coding agent
  const availableProviders = useMemo(() => {
    return getAiProvidersForScheduledRuntime(watchedProvider, watchedCodingAgent);
  }, [watchedProvider, watchedCodingAgent]);

  // Cascading: available models filtered by the exact admitted runtime pair.
  const availableModels = useMemo(() => {
    return getModelsForScheduledRuntime(watchedCodingAgent, watchedAiProvider);
  }, [watchedAiProvider, watchedCodingAgent]);

  // Reasoning options vary by runtime, not just by API provider.
  const availableReasoningLevels = useMemo(() => {
    return getScheduledReasoningLevelOptions({
      codingAgent: watchedCodingAgent ?? undefined,
      aiProvider: watchedAiProvider ?? undefined,
      model: watchedAiModel,
    });
  }, [watchedAiModel, watchedAiProvider, watchedCodingAgent]);

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
    // Existing raw runtime strings are an edit-boundary concern, not new
    // selection options. Reconcile descendants only after the user picks a new
    // coding agent (or while creating a new config).
    if (isEditing && !form.getFieldState("codingAgent").isDirty) return;

    const currentCodingAgent = form.getValues("codingAgent");
    const currentProvider = form.getValues("provider");
    const providersForCurrentRuntime = getAiProvidersForScheduledRuntime(
      currentProvider,
      currentCodingAgent,
    );
    const providerValues = new Set<string>(providersForCurrentRuntime);
    const currentAiProvider = form.getValues("aiProvider");

    if (providersForCurrentRuntime.length === 1) {
      if (currentAiProvider !== providersForCurrentRuntime[0]) {
        form.setValue("aiProvider", providersForCurrentRuntime[0]);
        form.setValue("aiModel", "");
        form.setValue("reasoningLevel", undefined);
      }
    } else if (currentAiProvider && !providerValues.has(currentAiProvider)) {
      form.setValue("aiProvider", "");
      form.setValue("aiModel", "");
      form.setValue("reasoningLevel", undefined);
    }
  }, [availableProviders, isEditing, open, form, watchedAiProvider]);

  useEffect(() => {
    if (!open) return;
    const runtimeSelectionChanged =
      form.getFieldState("codingAgent").isDirty ||
      form.getFieldState("aiProvider").isDirty ||
      form.getFieldState("aiModel").isDirty;
    if (isEditing && !runtimeSelectionChanged) return;

    const current = form.getValues("reasoningLevel");
    if (current && !availableReasoningLevels.some((option) => option.value === current)) {
      form.setValue("reasoningLevel", undefined);
    }
  }, [availableReasoningLevels, isEditing, open, form]);

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
      codingAgent: normalizeScheduledCodingAgent(watchedCodingAgent) ?? null,
      aiProvider: normalizeScheduledAiProvider(watchedAiProvider) ?? null,
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
    const runtimeDirtyFields: ScheduledRuntimeDirtyFields = {
      provider: form.formState.dirtyFields.provider === true,
      codingAgent: form.formState.dirtyFields.codingAgent === true,
      aiProvider: form.formState.dirtyFields.aiProvider === true,
      aiModel: form.formState.dirtyFields.aiModel === true,
      reasoningLevel: form.formState.dirtyFields.reasoningLevel === true,
    };
    const capabilitySelectionChanged =
      form.getFieldState("needsBrowser").isDirty ||
      form.getFieldState("selectedPluginIds").isDirty ||
      form.getFieldState("selectedMcpServerIds").isDirty;
    const shouldValidateRuntime =
      !isEditing ||
      hasScheduledAgentRuntimeFieldChanges(runtimeDirtyFields) ||
      capabilitySelectionChanged;

    if (shouldValidateRuntime) {
      const admission = resolveScheduledAgentRuntimeAdmission(values);
      if (!admission.admitted) {
        const fieldName = admission.dimension === "codingAgent"
          ? "codingAgent"
          : admission.dimension === "aiProvider" || admission.dimension === "authClass"
            ? "aiProvider"
            : admission.dimension === "model"
              ? "aiModel"
              : admission.value === "browser"
                ? "needsBrowser"
                : admission.value === "extensions"
                  ? "selectedPluginIds"
                  : "selectedMcpServerIds";
        form.setError(fieldName, {
          type: "runtime-policy",
          message: `Runtime selection is unavailable (${admission.code}).`,
        });
        return;
      }
    }

    const scheduleConfig =
      values.scheduleType === "manual"
        ? null
        : values.scheduleType === "time_window"
          ? {
              startHour: values.startHour!,
              endHour: values.endHour!,
              daysOfWeek: values.daysOfWeek!,
            }
          : values.scheduleType === "once"
            ? buildOnceScheduleConfig(values)
            : { expression: values.cronExpression! };

    const runtimeFields = resolveScheduledAgentSubmitRuntimeFields(values, {
      isEditing,
      dirtyFields: runtimeDirtyFields,
    });
    // The old raw mcpServersJson textarea is gone: the backend fails closed on
    // unmanaged remote MCP URLs. Managed catalog selections are persisted in
    // targetConfig and materialized server-side at dispatch.
    const submittedMcpServers = null;
    const toolingSelection = buildAgentToolingSelection(values);
    const toolingSelectionChanged =
      form.getFieldState("selectedPluginIds").isDirty ||
      form.getFieldState("selectedMcpServerIds").isDirty;
    const hasToolingSelection =
      toolingSelection.selectedPluginIds.length > 0 ||
      toolingSelection.selectedMcpServerIds.length > 0;
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

    const data: CreateScheduledAgentData | UpdateScheduledAgentData = {
      ...(!isEditing && isWebhookTrigger ? { id: values.webhookId } : {}),
      name: values.name,
      projectId: resolveScheduledAgentSubmitProjectId(values),
      prompt: submittedPrompt,
      jobType: resolveScheduledAgentSubmitJobType(values),
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
      mcpServers: submittedMcpServers,
      targetConfig: (() => {
        const generatedTargetConfig = isBuiltinAutomation
          ? buildBuiltinAutomationTargetConfig({
              ...values,
              allProjectIds: projects.map((project) => project.id),
            })
          : undefined;
        let submittedTargetConfig = generatedTargetConfig;

        // Built-in automations regenerate their queue fields, but unrelated
        // adapter metadata must survive those edits byte-for-byte.
        if (submittedTargetConfig && config?.targetConfig?.customFilters) {
          submittedTargetConfig = {
            ...submittedTargetConfig,
            customFilters: config.targetConfig.customFilters,
          };
        }

        if (hasToolingSelection || toolingSelectionChanged) {
          submittedTargetConfig = mergeAgentToolingSelectionIntoTargetConfig(
            submittedTargetConfig ?? (isEditing ? config?.targetConfig : undefined),
            toolingSelection,
          );
        }

        if (!isEditing || form.getFieldState("needsBrowser").isDirty) {
          submittedTargetConfig = mergeAgentBrowserSelectionIntoTargetConfig(
            submittedTargetConfig ?? (isEditing ? config?.targetConfig : undefined),
            values.needsBrowser,
          );
        }

        return submittedTargetConfig;
      })(),
    };

    onSubmit(data);
  });

  return {
    form,
    onSubmit: handleSubmit,
    skills: flatSkills,
    userSkills,
    plugins,
    mcpServers,
    selectedPluginIds,
    selectedMcpServerIds,
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
    onceRunAtPastWarning,
    lastRunAt: config?.lastRunAt ?? null,
  };
};

"use client";

import { Cpu } from "lucide-react";
import { useTranslations } from "next-intl";
import { AnthropicIcon } from "@/components/icons/anthropic-icon";
import { ClaudeIcon } from "@/components/icons/claude-icon";
import { CodexIcon } from "@/components/icons/codex-icon";
import { GoogleIcon } from "@/components/icons/google-icon";
import { OpenCodeIcon } from "@/components/icons/opencode-icon";
import { OpenAIIcon } from "@/components/icons/openai-icon";
import { XAIIcon } from "@/components/icons/xai-icon";
import { ZAIIcon } from "@/components/icons/zai-icon";
import { SelectItem } from "@/components/ui/select";
import {
  getProjectRuntimeAiProviders,
  getProjectRuntimeCodingAgents,
  type ProjectRuntimeField,
  type ProjectRuntimeScope,
} from "../../domain/project-runtime-selection";
import type {
  ProjectImplementationAiProvider,
  ProjectImplementationCodingAgent,
} from "../../domain/types";

export interface DevFlowRuntimeOption<T extends string> {
  value: T;
  label: string;
  icon: React.ReactNode;
}

const codingAgentIcon = (codingAgent: ProjectImplementationCodingAgent): React.ReactNode => {
  switch (codingAgent) {
    case "claude-code":
      return <ClaudeIcon className="h-4 w-4" />;
    case "codex":
      return <CodexIcon className="h-4 w-4" />;
    case "opencode":
      return <OpenCodeIcon className="h-4 w-4" />;
    case "pi":
      return <Cpu className="h-4 w-4" />;
  }
};

const aiProviderIcon = (aiProvider: ProjectImplementationAiProvider): React.ReactNode => {
  switch (aiProvider) {
    case "anthropic":
      return <AnthropicIcon className="h-4 w-4" />;
    case "google":
      return <GoogleIcon className="h-4 w-4" />;
    case "openai":
      return <OpenAIIcon className="h-4 w-4" />;
    case "xai":
      return <XAIIcon className="h-4 w-4" />;
    case "zai":
      return <ZAIIcon className="h-4 w-4" />;
  }
};

export const useCodingAgentOptions = (
  scope: ProjectRuntimeScope = "dev-flow-default",
): DevFlowRuntimeOption<ProjectImplementationCodingAgent>[] => {
  const t = useTranslations("projects.devFlow.runtimeOptions.codingAgent");
  return getProjectRuntimeCodingAgents(scope).map((codingAgent) => ({
    value: codingAgent,
    label: t(codingAgent === "claude-code" ? "claudeCode" : codingAgent),
    icon: codingAgentIcon(codingAgent),
  }));
};

export const useAiProviderOptions = (
  scope: ProjectRuntimeScope = "dev-flow-default",
  codingAgent?: string | null,
): DevFlowRuntimeOption<ProjectImplementationAiProvider>[] => {
  const t = useTranslations("projects.devFlow.runtimeOptions.aiProvider");
  return getProjectRuntimeAiProviders(scope, codingAgent).map((aiProvider) => ({
    value: aiProvider,
    label: t(aiProvider),
    icon: aiProviderIcon(aiProvider),
  }));
};

export const retainedRuntimeSelectValue = (
  field: ProjectRuntimeField,
  value: string | null | undefined,
): string => value && value.length > 0 ? value : `__retained-default-${field}__`;

export const RetainedRuntimeSelectItem = ({
  field,
  value,
}: {
  field: ProjectRuntimeField;
  value: string | null | undefined;
}) => {
  const t = useTranslations("projects.runtimeSelection");
  const label = t(`fields.${field}`);
  return (
    <SelectItem value={retainedRuntimeSelectValue(field, value)} disabled>
      {value == null || value === ""
        ? t("retainedDefault", { field: label })
        : t("retainedValue", { field: label, value })}
    </SelectItem>
  );
};

export const RetainedRuntimeNotice = ({
  field,
  value,
}: {
  field: ProjectRuntimeField;
  value: string | null | undefined;
}) => {
  const t = useTranslations("projects.runtimeSelection");
  const label = t(`fields.${field}`);
  return (
    <p className="rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-900 dark:text-amber-200">
      {value == null || value === ""
        ? t("retainedDefault", { field: label })
        : t("retainedValue", { field: label, value })}
    </p>
  );
};

const REJECTION_KEYS = {
  PI_CAPABILITY_READ_ONLY_ENFORCEMENT_DISABLED:
    "rejections.PI_CAPABILITY_READ_ONLY_ENFORCEMENT_DISABLED",
  RUNTIME_CODING_AGENT_UNSUPPORTED: "rejections.RUNTIME_CODING_AGENT_UNSUPPORTED",
  RUNTIME_AI_PROVIDER_UNSUPPORTED: "rejections.RUNTIME_AI_PROVIDER_UNSUPPORTED",
  RUNTIME_MODEL_UNSUPPORTED: "rejections.RUNTIME_MODEL_UNSUPPORTED",
  RUNTIME_ADMISSION_DISABLED: "rejections.RUNTIME_ADMISSION_DISABLED",
} as const;

export const ProjectRuntimeRejectionNotice = ({ code }: { code: string }) => {
  const t = useTranslations("projects.runtimeSelection");
  const key = REJECTION_KEYS[code as keyof typeof REJECTION_KEYS];
  if (!key) return null;
  return (
    <p className="rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-900 dark:text-amber-200">
      {t(key)} <span className="font-mono">({code})</span>
    </p>
  );
};

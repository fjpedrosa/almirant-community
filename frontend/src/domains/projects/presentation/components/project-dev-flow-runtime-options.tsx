"use client";

import { useTranslations } from "next-intl";
import { AnthropicIcon } from "@/components/icons/anthropic-icon";
import { ClaudeIcon } from "@/components/icons/claude-icon";
import { CodexIcon } from "@/components/icons/codex-icon";
import { OpenCodeIcon } from "@/components/icons/opencode-icon";
import { OpenAIIcon } from "@/components/icons/openai-icon";
import { XAIIcon } from "@/components/icons/xai-icon";
import { ZAIIcon } from "@/components/icons/zai-icon";
import type { ProjectImplementationAiProvider, ProjectImplementationCodingAgent } from "../../domain/types";

/**
 * Shared runtime option catalogs (coding agent / AI provider) for every
 * "Automated dev flow" runtime select — both the card-level defaults
 * (project-dev-flow-card.tsx) and each automation row's own override
 * (project-dev-flow-automation-row.tsx). Kept in its own module so the two
 * don't need to import from each other (which would create a cycle).
 *
 * Labels are exposed as hooks (rather than plain constants) so they're
 * routed through next-intl's `projects.devFlow.runtimeOptions` namespace
 * like every other card string (issue #247) — even though these are
 * product/brand names that read identically in every locale today, keeping
 * them in the catalog keeps this file free of hardcoded UI copy and ready
 * for a locale that does need a different label.
 */
export interface DevFlowRuntimeOption<T extends string> {
  value: T;
  label: string;
  icon: React.ReactNode;
}

export const useCodingAgentOptions = (): DevFlowRuntimeOption<ProjectImplementationCodingAgent>[] => {
  const t = useTranslations("projects.devFlow.runtimeOptions.codingAgent");
  return [
    { value: "claude-code", label: t("claudeCode"), icon: <ClaudeIcon className="h-4 w-4" /> },
    { value: "codex", label: t("codex"), icon: <CodexIcon className="h-4 w-4" /> },
    { value: "opencode", label: t("opencode"), icon: <OpenCodeIcon className="h-4 w-4" /> },
  ];
};

export const useAiProviderOptions = (): DevFlowRuntimeOption<ProjectImplementationAiProvider>[] => {
  const t = useTranslations("projects.devFlow.runtimeOptions.aiProvider");
  return [
    { value: "anthropic", label: t("anthropic"), icon: <AnthropicIcon className="h-4 w-4" /> },
    { value: "openai", label: t("openai"), icon: <OpenAIIcon className="h-4 w-4" /> },
    { value: "zai", label: t("zai"), icon: <ZAIIcon className="h-4 w-4" /> },
    { value: "xai", label: t("xai"), icon: <XAIIcon className="h-4 w-4" /> },
  ];
};

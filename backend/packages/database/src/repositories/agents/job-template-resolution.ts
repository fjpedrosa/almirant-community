import type { AgentJobConfig } from "../../schema/agent-jobs";

type JobTemplateResolutionInput = {
  jobType?: string | null;
  prompt?: string | null;
  promptTemplate?: string | null;
  skillName?: string | null;
  config?: Pick<AgentJobConfig, "prompt" | "skillName"> | null;
};

type ResolvedJobTemplateFields = {
  prompt: string | null;
  skillName: string | null;
  promptTemplate: string | null;
  isPromptOnly: boolean;
};

const getNonEmptyString = (value: unknown): string | null => {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
};

/**
 * Resolves the persisted prompt/template fields during the prompt+template
 * migration while keeping prompt-only jobs null-safe.
 */
export const resolvePersistedJobTemplateFields = (
  input: JobTemplateResolutionInput,
): ResolvedJobTemplateFields => {
  const resolvedPrompt =
    getNonEmptyString(input.prompt) ??
    getNonEmptyString(input.config?.prompt) ??
    null;

  const explicitPromptTemplate = getNonEmptyString(input.promptTemplate);
  const explicitSkillName =
    getNonEmptyString(input.skillName) ??
    getNonEmptyString(input.config?.skillName);
  const normalizedJobType = getNonEmptyString(input.jobType)?.toLowerCase();
  const defaultSkillName =
    normalizedJobType === "integration"
      ? "runner-release-integration"
      : "implement";

  const isPromptOnly =
    resolvedPrompt !== null &&
    explicitPromptTemplate === null &&
    explicitSkillName === null;

  const resolvedSkillName = isPromptOnly
    ? null
    : (explicitSkillName ?? explicitPromptTemplate ?? defaultSkillName);

  return {
    prompt: resolvedPrompt,
    skillName: resolvedSkillName,
    promptTemplate: isPromptOnly
      ? null
      : (explicitPromptTemplate ?? resolvedSkillName),
    isPromptOnly,
  };
};

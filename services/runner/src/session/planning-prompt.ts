import {
  MAX_NATIVE_PLAN_V1_OUTPUT_CHARS,
  NATIVE_PLAN_V1_MARKER,
} from "@almirant/shared";
import type { RuntimeType } from "../shared/types";

export type PlanningConversationEntry = {
  role: string;
  content: string;
};

export type BuildPlanningPromptParams = {
  runtimeType: RuntimeType;
  skillName: string;
  skillContent?: string | null;
  userMessage?: string | null;
  promptLocale?: string | null;
  seedIds?: string[];
  sessionRecoveryContext?: string | null;
  previousJobRecoveryContext?: string | null;
  conversationHistory?: PlanningConversationEntry[];
  planningContract?: unknown;
};

const NATIVE_PLAN_BLOCK_START = '<native_plan_protocol trusted="runner" version="plan-v1">';
const NATIVE_PLAN_BLOCK_END = "</native_plan_protocol>";
const NATIVE_PLAN_BLOCK = [
  NATIVE_PLAN_BLOCK_START,
  'planningContract: "plan-v1" is active for this invocation.',
  `Final assistant text must be exactly ${NATIVE_PLAN_V1_MARKER} followed by LF and one targetless Plan V1 JSON object, with no prose, fence, or trailing text.`,
  `Keep the entire final assistant text at most ${MAX_NATIVE_PLAN_V1_OUTPUT_CHARS} characters.`,
  "Use only structured question events for clarification; emit no plain assistant clarification or progress text.",
  "Do not call create, update, dependency, acceptance, persistence, or memory-write tools, and do not fabricate unavailable facts or statuses.",
  NATIVE_PLAN_BLOCK_END,
].join("\n");

const neutralizeNativePlanProtocolText = (value: string): string =>
  value
    .replace(/ALMIRANT\s*:\s*NATIVE_PLAN_V1/gi, "[reserved-plan-marker]")
    .replace(/native[\s_-]*plan[\s_-]*protocol/gi, "[reserved-plan-wrapper]");

export const applyNativePlanPromptProtocol = (
  prompt: string,
  planningContract: unknown,
): string => {
  const neutralized = neutralizeNativePlanProtocolText(prompt);
  if (planningContract !== "plan-v1") return neutralized;
  return `${neutralized}\n\n${NATIVE_PLAN_BLOCK}`.trim();
};

const LOCALE_NAMES: Record<string, string> = {
  en: "English",
  es: "Spanish",
};

const buildLocaleInstruction = (locale?: string | null): string => {
  const languageName = locale ? (LOCALE_NAMES[locale] ?? LOCALE_NAMES.es) : LOCALE_NAMES.es;
  return `IMPORTANT: You MUST respond in ${languageName}. All user-facing text (summaries, descriptions, comments, PR bodies, commit messages, progress updates) must be in ${languageName}.`;
};

const buildHistoryBlock = (
  conversationHistory: PlanningConversationEntry[],
): string | null => {
  if (conversationHistory.length === 0) {
    return null;
  }

  const historyBlock = conversationHistory
    .map((message) =>
      `${message.role === "user" ? "User" : "Assistant"}: ${neutralizeNativePlanProtocolText(message.content)}`,
    )
    .join("\n\n");

  return `<previous_conversation>\n${historyBlock}\n</previous_conversation>`;
};

const appendSection = (sections: string[], value?: string | null): void => {
  if (!value) {
    return;
  }

  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return;
  }

  sections.push(trimmed);
};

const hasPromptContext = (
  params: Pick<
    BuildPlanningPromptParams,
    | "userMessage"
    | "seedIds"
    | "sessionRecoveryContext"
    | "previousJobRecoveryContext"
    | "conversationHistory"
  >,
): boolean => {
  const hasUserMessage = (params.userMessage?.trim().length ?? 0) > 0;
  const hasSeeds = (params.seedIds?.length ?? 0) > 0;
  const hasSessionRecovery = (params.sessionRecoveryContext?.trim().length ?? 0) > 0;
  const hasPreviousRecovery = (params.previousJobRecoveryContext?.trim().length ?? 0) > 0;
  const hasConversationHistory = (params.conversationHistory?.length ?? 0) > 0;

  return (
    hasUserMessage
    || hasSeeds
    || hasSessionRecovery
    || hasPreviousRecovery
    || hasConversationHistory
  );
};

export const shouldInlinePlanningSkillContent = (
  runtimeType: RuntimeType,
  params?: Pick<
    BuildPlanningPromptParams,
    | "userMessage"
    | "seedIds"
    | "sessionRecoveryContext"
    | "previousJobRecoveryContext"
    | "conversationHistory"
  >,
): boolean => runtimeType !== "claude-shim" || hasPromptContext(params ?? {});

export const buildPlanningPrompt = (
  params: BuildPlanningPromptParams,
): string => {
  const skillName = neutralizeNativePlanProtocolText(params.skillName);
  const skillContent = params.skillContent
    ? neutralizeNativePlanProtocolText(params.skillContent)
    : null;
  const userMessage = neutralizeNativePlanProtocolText(params.userMessage?.trim() ?? "");
  const seedIds = params.seedIds?.map(neutralizeNativePlanProtocolText);
  const previousJobRecoveryContext = params.previousJobRecoveryContext
    ? neutralizeNativePlanProtocolText(params.previousJobRecoveryContext)
    : null;
  const sessionRecoveryContext = params.sessionRecoveryContext
    ? neutralizeNativePlanProtocolText(params.sessionRecoveryContext)
    : null;
  const sections: string[] = [];
  const userRequestBlock = userMessage.length > 0
    ? `<user_request>\n${userMessage}\n</user_request>`
    : null;
  const usesSlashCommand =
    params.runtimeType === "claude-shim"
    && !shouldInlinePlanningSkillContent(params.runtimeType, params);

  if (usesSlashCommand) {
    sections.push(`/${skillName}`);
    appendSection(sections, buildLocaleInstruction(params.promptLocale));
  } else {
    appendSection(
      sections,
      skillContent
        ? `<skill name="${skillName}">\n${skillContent}\n</skill>`
        : null,
    );
    appendSection(sections, buildLocaleInstruction(params.promptLocale));
  }

  appendSection(
    sections,
    seedIds && seedIds.length > 0
      ? `Seed IDs for context (use get_seeds_for_ideation to fetch details): ${seedIds.join(", ")}`
      : null,
  );
  appendSection(
    sections,
    previousJobRecoveryContext
      ? `<previous_job_recovery>\n${previousJobRecoveryContext}\n</previous_job_recovery>`
      : null,
  );
  appendSection(
    sections,
    sessionRecoveryContext
      ? `<session_recovery>\n${sessionRecoveryContext}\n</session_recovery>`
      : null,
  );
  appendSection(
    sections,
    buildHistoryBlock(params.conversationHistory ?? []),
  );
  if (!usesSlashCommand) {
    appendSection(
      sections,
      `Start the ${skillName} session using the following user request.`,
    );
  }
  // Keep the current request at the end of the prompt so resumed sessions do
  // not let the previous conversation overshadow the user's latest instruction.
  appendSection(
    sections,
    userRequestBlock
      ?? (usesSlashCommand
        ? null
        : "No explicit user request was provided. Start by eliciting the missing idea or goal."),
  );

  return applyNativePlanPromptProtocol(
    sections.join("\n\n").trim(),
    params.planningContract,
  );
};

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
      `${message.role === "user" ? "User" : "Assistant"}: ${message.content}`,
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
  const userMessage = params.userMessage?.trim() ?? "";
  const sections: string[] = [];
  const userRequestBlock = userMessage.length > 0
    ? `<user_request>\n${userMessage}\n</user_request>`
    : null;
  const usesSlashCommand =
    params.runtimeType === "claude-shim"
    && !shouldInlinePlanningSkillContent(params.runtimeType, params);

  if (usesSlashCommand) {
    sections.push(`/${params.skillName}`);
    appendSection(sections, buildLocaleInstruction(params.promptLocale));
  } else {
    appendSection(
      sections,
      params.skillContent
        ? `<skill name="${params.skillName}">\n${params.skillContent}\n</skill>`
        : null,
    );
    appendSection(sections, buildLocaleInstruction(params.promptLocale));
  }

  appendSection(
    sections,
    params.seedIds && params.seedIds.length > 0
      ? `Seed IDs for context (use get_seeds_for_ideation to fetch details): ${params.seedIds.join(", ")}`
      : null,
  );
  appendSection(
    sections,
    params.previousJobRecoveryContext
      ? `<previous_job_recovery>\n${params.previousJobRecoveryContext}\n</previous_job_recovery>`
      : null,
  );
  appendSection(
    sections,
    params.sessionRecoveryContext
      ? `<session_recovery>\n${params.sessionRecoveryContext}\n</session_recovery>`
      : null,
  );
  appendSection(
    sections,
    buildHistoryBlock(params.conversationHistory ?? []),
  );
  if (!usesSlashCommand) {
    appendSection(
      sections,
      `Start the ${params.skillName} session using the following user request.`,
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

  return sections.join("\n\n").trim();
};

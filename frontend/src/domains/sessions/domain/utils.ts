import type { AgentJobStatus } from "@/domains/agents/domain/types";
import type { AgentLogChunk } from "@/domains/shared/domain/types";
import type { AgentSessionListItem } from "./types";

// ---------------------------------------------------------------------------
// Active-status helpers
// ---------------------------------------------------------------------------

export const ACTIVE_STATUSES = new Set<AgentJobStatus>([
  "queued",
  "running",
  "finalizing",
  "waiting_for_input",
  "paused",
]);

export const isAgentSessionActive = (
  status: AgentJobStatus | null | undefined
): boolean => {
  if (!status) return false;
  return ACTIVE_STATUSES.has(status);
};

// ---------------------------------------------------------------------------
// Chunk helpers
// ---------------------------------------------------------------------------

export const sortChunks = (chunks: AgentLogChunk[]): AgentLogChunk[] =>
  [...chunks].sort((left, right) => {
    if (left.seq !== right.seq) return left.seq - right.seq;
    return left.timestamp.localeCompare(right.timestamp);
  });

export const mergeChunks = (
  currentChunks: AgentLogChunk[],
  nextChunks: AgentLogChunk[]
): AgentLogChunk[] => {
  const bySeq = new Map<number, AgentLogChunk>();

  for (const chunk of currentChunks) {
    bySeq.set(chunk.seq, chunk);
  }

  for (const chunk of nextChunks) {
    bySeq.set(chunk.seq, chunk);
  }

  return sortChunks(Array.from(bySeq.values()));
};

// ---------------------------------------------------------------------------
// Duration helpers
// ---------------------------------------------------------------------------

export const getSessionDurationMs = (
  startedAt: string | null,
  completedAt: string | null,
  durationMs: number | null,
  currentTime: number
): number | null => {
  if (typeof durationMs === "number" && durationMs >= 0) return durationMs;
  if (!startedAt) return null;

  const started = new Date(startedAt).getTime();
  if (Number.isNaN(started)) return null;

  const finished = completedAt ? new Date(completedAt).getTime() : currentTime;
  return Math.max(0, finished - started);
};

export const getDurationMs = (
  session: AgentSessionListItem,
  currentTime: number
): number | null =>
  getSessionDurationMs(
    session.startedAt,
    session.completedAt ?? session.failedAt ?? null,
    session.durationMs,
    currentTime
  );

export const formatDuration = (durationMs: number | null): string => {
  if (durationMs === null) return "-";

  const totalSeconds = Math.floor(durationMs / 1000);
  if (totalSeconds < 60) return `${totalSeconds}s`;

  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes < 60) return `${minutes}m ${seconds}s`;

  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  return `${hours}h ${remainingMinutes}m ${seconds}s`;
};

// ---------------------------------------------------------------------------
// Model / skill resolution
// ---------------------------------------------------------------------------

export const resolveModel = (
  topLevel: unknown,
  configModel: unknown,
  fallback: unknown
): string => {
  if (typeof topLevel === "string" && topLevel.trim().length > 0)
    return topLevel;
  if (typeof configModel === "string" && configModel.trim().length > 0)
    return configModel;
  if (typeof fallback === "string" && fallback.trim().length > 0)
    return fallback;
  return "auto";
};

export const resolveSkill = (
  jobType: string | undefined,
  skillName: unknown
): string => {
  if (typeof skillName === "string" && skillName.trim().length > 0) {
    return skillName;
  }

  return jobType ?? "-";
};

export const resolveSkillLabel = (
  session: AgentSessionListItem
): string => {
  const skillName = session.config?.skillName;
  if (typeof skillName === "string" && skillName.trim().length > 0)
    return skillName;
  return session.jobType ?? "-";
};

const getTrimmedString = (value: unknown): string | null => {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
};

const HUMAN_SESSION_LAUNCH_SOURCES = new Set([
  "api",
  "web",
  "websocket",
  "resume",
  "discord_component",
]);

export type SessionLauncherIdentity =
  | {
      kind: "user";
      label: string;
      imageUrl: string | null;
    }
  | {
      kind: "bot";
      label: "Almirant[bot]";
      imageUrl: null;
    }
  | null;

/**
 * User id used when an admin/system flow needs the `mcp:internal` session
 * token: the job is attributed to the auto-fix-bot so the backend mints the
 * privileged token, and the real human launcher (if any) is preserved in
 * `config.requestedByUserId`. Keep in sync with
 * `backend/api/src/shared/services/session-token.ts`.
 */
const AUTOMATION_BOT_USER_ID = "auto-fix-bot";

export const resolveSessionLauncherIdentity = (
  session: Pick<
    AgentSessionListItem,
    | "createdByUserId"
    | "createdByUserName"
    | "createdByUserImage"
    | "requestedByUserName"
    | "requestedByUserImage"
    | "triggerType"
    | "config"
  >
): SessionLauncherIdentity => {
  const createdByUserId = getTrimmedString(session.createdByUserId);
  const requestedByUserId = getTrimmedString(
    session.config?.requestedByUserId as string | undefined,
  );

  // Bot-attributed jobs launched by a human (admin "Launch investigation",
  // future system flows): surface the real requester instead of "Auto-Fix Bot".
  // The user row for AUTOMATION_BOT_USER_ID exists so the JOIN populates
  // createdByUserName with "Auto-Fix Bot", which is misleading here.
  if (createdByUserId === AUTOMATION_BOT_USER_ID && requestedByUserId) {
    const requestedByUserName = getTrimmedString(session.requestedByUserName);
    if (requestedByUserName) {
      return {
        kind: "user",
        label: `${requestedByUserName} via Auto-Fix`,
        imageUrl: session.requestedByUserImage ?? null,
      };
    }
    return {
      kind: "user",
      label: "Usuario",
      imageUrl: null,
    };
  }

  const createdByUserName = getTrimmedString(session.createdByUserName);
  if (createdByUserName) {
    return {
      kind: "user",
      label: createdByUserName,
      imageUrl: session.createdByUserImage ?? null,
    };
  }

  // A human triggered the job: we know who launched it even if the user row
  // has no display name (e.g. system accounts, not-yet-synced profile).
  if (createdByUserId) {
    return {
      kind: "user",
      label: "Usuario",
      imageUrl: session.createdByUserImage ?? null,
    };
  }

  // Cron/recovery dispatches have no human behind them.
  if (session.triggerType === "scheduled" || session.triggerType === "recovery") {
    return {
      kind: "bot",
      label: "Almirant[bot]",
      imageUrl: null,
    };
  }

  const source = getTrimmedString(session.config?.source);
  const requesterDiscordUserId = getTrimmedString(
    session.config?.requesterDiscordUserId,
  );

  const launchedByBot = source
    ? !HUMAN_SESSION_LAUNCH_SOURCES.has(source)
    : !requesterDiscordUserId;

  if (!launchedByBot) return null;

  return {
    kind: "bot",
    label: "Almirant[bot]",
    imageUrl: null,
  };
};

export const getScheduledConfigName = (
  config: AgentSessionListItem["config"] | null | undefined
): string | null => getTrimmedString(config?.scheduledConfigName);

export const getExecutionName = (
  config: AgentSessionListItem["config"] | null | undefined
): string | null => getTrimmedString(config?.executionName);

export const getSessionResultSummary = (
  result: AgentSessionListItem["result"] | null | undefined
): string | null => getTrimmedString(result?.summary);

export const formatCompactSessionId = (
  sessionId: string | null | undefined
): string => {
  const normalized = getTrimmedString(sessionId);
  if (!normalized) return "-";
  if (normalized.length <= 12) return normalized;
  return `${normalized.slice(0, 8)}…${normalized.slice(-4)}`;
};

type SessionDisplayOptions = {
  planningSessionTitle?: string | null;
};

const resolvePlanningTitle = (
  session: AgentSessionListItem,
  options?: SessionDisplayOptions
): string | null =>
  getTrimmedString(options?.planningSessionTitle ?? session.planningSessionTitle);

const resolveFeedbackTitle = (
  session: AgentSessionListItem
): string | null => getTrimmedString(session.feedbackItemTitle);

export const resolveSessionDisplayTitle = (
  session: AgentSessionListItem,
  options?: SessionDisplayOptions
): string => {
  const executionName = getExecutionName(session.config);
  const scheduledConfigName = getScheduledConfigName(session.config);
  const planningTitle = resolvePlanningTitle(session, options);
  const feedbackTitle = resolveFeedbackTitle(session);
  const workItemTitle = getTrimmedString(session.workItemTitle);
  const workItemTaskId = getTrimmedString(session.workItemTaskId);

  if (session.jobType === "scheduled") {
    return executionName ?? scheduledConfigName ?? formatCompactSessionId(session.id);
  }

  if (session.jobType === "planning") {
    return planningTitle ?? formatCompactSessionId(session.id);
  }

  return (
    workItemTitle ??
    feedbackTitle ??
    planningTitle ??
    workItemTaskId ??
    executionName ??
    scheduledConfigName ??
    formatCompactSessionId(session.id)
  );
};

export const resolveSessionDisplaySummary = (
  session: AgentSessionListItem,
  options?: SessionDisplayOptions
): string | null => {
  const resultSummary = getSessionResultSummary(session.result);
  if (resultSummary) return resultSummary;

  const errorMessage = getTrimmedString(session.errorMessage);
  if (session.status === "failed" && errorMessage) return errorMessage;

  const workItemTitle = getTrimmedString(session.workItemTitle);
  if (workItemTitle) return workItemTitle;

  const planningTitle = resolvePlanningTitle(session, options);
  const title = resolveSessionDisplayTitle(session, options);
  if (planningTitle && planningTitle !== title) return planningTitle;

  return null;
};

export const resolveSessionHeadline = (
  session: AgentSessionListItem,
  options?: SessionDisplayOptions
): string =>
  getTrimmedString(session.workItemTitle) ??
  resolveFeedbackTitle(session) ??
  resolvePlanningTitle(session, options) ??
  getExecutionName(session.config) ??
  getScheduledConfigName(session.config) ??
  formatCompactSessionId(session.id);

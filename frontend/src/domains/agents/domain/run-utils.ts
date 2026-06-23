import type { AgentJob, AgentJobLog } from "./types";

const asDate = (value: string | Date | null | undefined): Date | null => {
  if (!value) return null;
  const parsed = typeof value === "string" ? new Date(value) : value;
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed;
};

export const getRunFinishedAt = (job: AgentJob): Date | null => {
  return asDate(job.completedAt) ?? asDate(job.failedAt);
};

export const getRunDurationMs = (job: AgentJob, nowMs = Date.now()): number | null => {
  if (typeof job.durationMs === "number" && job.durationMs >= 0) {
    return job.durationMs;
  }

  const cumulative = job.cumulativeDurationMs ?? 0;

  const startedAt = asDate(job.startedAt);
  if (!startedAt) {
    return cumulative > 0 ? cumulative : null;
  }

  const finishedAt = getRunFinishedAt(job);
  const endTime = finishedAt ? finishedAt.getTime() : nowMs;
  const currentSegmentMs = Math.max(0, endTime - startedAt.getTime());
  return cumulative + currentSegmentMs;
};

export const formatRunDuration = (durationMs: number | null): string => {
  if (durationMs === null || durationMs === undefined) return "-";

  const seconds = Math.floor(durationMs / 1000);
  if (seconds < 60) return `${seconds}s`;

  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  if (minutes < 60) return `${minutes}m ${remainingSeconds}s`;

  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  return `${hours}h ${remainingMinutes}m`;
};

export const resolveRunModel = (job: AgentJob): string => {
  if (typeof job.model === "string" && job.model.trim().length > 0) {
    return job.model.trim();
  }

  const fromConfig = job.config?.model;
  if (typeof fromConfig === "string" && fromConfig.trim().length > 0) {
    return fromConfig.trim();
  }

  const modelFromResult = job.result?.model;
  if (typeof modelFromResult === "string" && modelFromResult.trim().length > 0) {
    return modelFromResult.trim();
  }

  return "auto";
};

type PauseReasonInput = {
  errorType?: string | null;
  errorMessage?: string | null;
};

const normalizePauseReason = (input?: PauseReasonInput): string => {
  if (!input) return "";
  return [input.errorType, input.errorMessage]
    .filter((value): value is string => typeof value === "string")
    .join(" ")
    .toLowerCase();
};

export const resolveRunStatusLabel = (
  status: AgentJob["status"],
  pauseReason?: PauseReasonInput,
): string => {
  switch (status) {
    case "finalizing":
      return "Finalizing";
    case "waiting_for_input":
      return "Waiting";
    case "paused": {
      const reason = normalizePauseReason(pauseReason);
      if (!reason) return "Paused";
      if (
        reason.includes("rate_limit") ||
        reason.includes("rate limit") ||
        reason.includes("too many requests") ||
        reason.includes("429")
      ) {
        return "Paused by rate limit";
      }
      if (reason.includes("subscription")) {
        return "Paused by subscription limit";
      }
      if (reason.includes("quota")) {
        return "Paused by quota";
      }
      if (reason.includes("limit")) {
        return "Paused by provider limit";
      }
      return "Paused";
    }
    case "incomplete":
      return "Incomplete";
    default: {
      const raw = status.replace(/_/g, " ");
      return raw.charAt(0).toUpperCase() + raw.slice(1);
    }
  }
};

export const resolveRunLastEvent = (job: AgentJob): string => {
  const fromSummary = job.result?.summary;
  if (typeof fromSummary === "string" && fromSummary.trim().length > 0) {
    return fromSummary.trim();
  }

  if (job.errorMessage) return job.errorMessage;

  switch (job.status) {
    case "queued":
      return "Queued";
    case "running":
      return "Running";
    case "finalizing":
      return "Finalizing";
    case "waiting_for_input":
      return "Waiting for input";
    case "paused":
      return resolveRunStatusLabel(job.status, {
        errorType: job.errorType,
        errorMessage: job.errorMessage,
      });
    case "completed":
      return "Completed";
    case "failed":
      return "Failed";
    case "cancelled":
      return "Cancelled";
    default:
      return "Unknown";
  }
};

export const sortLogsBySeq = (logs: AgentJobLog[]): AgentJobLog[] => {
  return [...logs].sort((a, b) => {
    if (a.seq !== b.seq) return a.seq - b.seq;
    return new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime();
  });
};

export const resolveRunLastError = (job: AgentJob, logs: AgentJobLog[]): string | null => {
  const latestError = [...logs]
    .reverse()
    .find((log) => log.level === "error");
  if (latestError) return latestError.message;
  return job.errorMessage ?? null;
};

export const formatRunDateTime = (value: string | Date | null | undefined): string => {
  const parsed = asDate(value);
  if (!parsed) return "-";
  return parsed.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
};

export type RootCauseCategory = "auth" | "rate_limit" | "generic";

export const parseRootCause = (errorMessage: string | null): string | null => {
  if (!errorMessage) return null;
  const match = errorMessage.match(/\[root cause:\s*(.+)\]$/);
  return match ? match[1].trim() : null;
};

export const classifyRootCause = (rootCause: string): RootCauseCategory => {
  const lower = rootCause.toLowerCase();
  if (lower.includes("401") || lower.includes("authentication") || lower.includes("unauthorized")) {
    return "auth";
  }
  if (lower.includes("429") || lower.includes("rate limit") || lower.includes("too many requests")) {
    return "rate_limit";
  }
  return "generic";
};

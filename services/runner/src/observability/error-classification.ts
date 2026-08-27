// ---------------------------------------------------------------------------
// Structured error classification — typed runtime failures take precedence,
// with the historical Claude/Codex/OpenCode strings retained as fallback.
// Pure functions only: raw error text is never inspected or logged here.
// ---------------------------------------------------------------------------

import {
  extractRuntimeFailure,
  type RuntimeFailure,
  type RuntimeFailureCategory,
} from "@almirant/shared";

export type ErrorClassification = {
  errorCode: string;
  errorCategory: "agent" | "infra" | "config" | "quota";
  recoverable: boolean;
  failureCategory?: RuntimeFailureCategory;
  retryable?: boolean;
  runtimeFailure?: RuntimeFailure;
};

const dashboardCategory = (
  category: RuntimeFailureCategory,
): ErrorClassification["errorCategory"] => {
  switch (category) {
    case "auth":
    case "model":
    case "endpoint":
    case "policy":
      return "config";
    case "protocol":
    case "process":
    case "cancellation":
      return "infra";
    case "usage":
      return "agent";
  }
};

const mapRuntimeFailure = (
  runtimeFailure: RuntimeFailure,
): ErrorClassification => ({
  errorCode: runtimeFailure.causeCode ?? runtimeFailure.code,
  errorCategory: dashboardCategory(runtimeFailure.category),
  recoverable: runtimeFailure.retryable,
  failureCategory: runtimeFailure.category,
  retryable: runtimeFailure.retryable,
  runtimeFailure,
});

const unknownClassification = (): ErrorClassification => ({
  errorCode: "unknown",
  errorCategory: "agent",
  recoverable: false,
});

/**
 * Consumes a direct or error-attached runtime failure before consulting the
 * historical category strings used by Claude, Codex, and OpenCode.
 */
export const mapErrorCategory = (input: unknown): ErrorClassification => {
  const runtimeFailure = extractRuntimeFailure(input);
  if (runtimeFailure) return mapRuntimeFailure(runtimeFailure);
  if (typeof input !== "string") return unknownClassification();

  switch (input) {
    case "recoverable_oom":
      return { errorCode: "oom", errorCategory: "infra", recoverable: true };
    case "recoverable_timeout":
      return { errorCode: "timeout", errorCategory: "infra", recoverable: true };
    case "recoverable_disconnect":
      return { errorCode: "disconnect", errorCategory: "infra", recoverable: true };
    case "permanent_auth":
      return { errorCode: "auth_failed", errorCategory: "config", recoverable: false };
    case "permanent_config":
      return { errorCode: "bad_config", errorCategory: "config", recoverable: false };
    default:
      return unknownClassification();
  }
};

/**
 * Maps failure patterns from job-completion-guards, while accepting the typed
 * taxonomy first when a newer runtime supplies it.
 */
export const mapFailurePattern = (input: unknown): ErrorClassification => {
  const runtimeFailure = extractRuntimeFailure(input);
  if (runtimeFailure) return mapRuntimeFailure(runtimeFailure);
  if (typeof input !== "string") return unknownClassification();

  switch (input) {
    case "prompt_too_long":
      return { errorCode: "prompt_too_long", errorCategory: "agent", recoverable: false };
    case "subscription_limit":
      return { errorCode: "subscription_limit", errorCategory: "quota", recoverable: true };
    case "rate_limit":
      return { errorCode: "rate_limit", errorCategory: "quota", recoverable: true };
    case "api_overloaded":
      return { errorCode: "api_overloaded", errorCategory: "infra", recoverable: true };
    case "no_skill_output":
      return { errorCode: "no_skill_output", errorCategory: "config", recoverable: false };
    case "no_skill_progress":
      return { errorCode: "no_skill_progress", errorCategory: "config", recoverable: false };
    default:
      return { errorCode: input, errorCategory: "agent", recoverable: false };
  }
};

export const noSkillProgressError = (): ErrorClassification => ({
  errorCode: "no_skill_progress",
  errorCategory: "config",
  recoverable: false,
});

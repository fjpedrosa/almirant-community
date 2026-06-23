// ---------------------------------------------------------------------------
// Structured error classification — maps runner error categories and failure
// patterns to machine-readable codes + high-level categories for dashboarding.
//
// Pure functions, no side effects. Used by the job executor to enrich
// canonical events (session.error, job.failed) with structured metadata.
// ---------------------------------------------------------------------------

export type ErrorClassification = {
  errorCode: string;
  errorCategory: "agent" | "infra" | "config" | "quota";
  recoverable: boolean;
};

/**
 * Maps the existing classifyError categories (from types.ts) to structured
 * error codes suitable for canonical events and frontend consumption.
 */
export const mapErrorCategory = (category: string): ErrorClassification => {
  switch (category) {
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
      return { errorCode: "unknown", errorCategory: "agent", recoverable: false };
  }
};

/**
 * Maps failure patterns from job-completion-guards (detectKnownFailurePatterns)
 * to structured error codes.
 */
export const mapFailurePattern = (patternType: string): ErrorClassification => {
  switch (patternType) {
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
      return { errorCode: patternType, errorCategory: "agent", recoverable: false };
  }
};

/**
 * Creates a no-skill-progress error classification.
 */
export const noSkillProgressError = (): ErrorClassification => ({
  errorCode: "no_skill_progress",
  errorCategory: "config",
  recoverable: false,
});

export type AgentErrorInfo = {
  title: string;
  description: string;
  /** Whether the user can take action to resolve it */
  actionable: boolean;
};

/** Maps machine-readable errorCode to user-facing messages */
export const AGENT_ERROR_MESSAGES: Record<string, AgentErrorInfo> = {
  // Quota errors
  subscription_limit: {
    title: "API limit reached",
    description:
      "Your plan's rate limit was hit. The agent will retry when it resets.",
    actionable: false,
  },
  rate_limit: {
    title: "Rate limit",
    description: "Too many requests. The agent will retry automatically.",
    actionable: false,
  },
  // Infrastructure errors
  timeout: {
    title: "Session timed out",
    description:
      "The agent session reached its time limit. Consider breaking the task into smaller pieces.",
    actionable: true,
  },
  oom: {
    title: "Out of memory",
    description:
      "The agent ran out of memory. This usually happens with very large files.",
    actionable: true,
  },
  disconnect: {
    title: "Connection lost",
    description:
      "The agent lost its connection. A retry may be scheduled automatically.",
    actionable: false,
  },
  api_overloaded: {
    title: "Service overloaded",
    description:
      "The AI service is temporarily overloaded. The agent will retry shortly.",
    actionable: false,
  },
  // Config errors
  no_skill_progress: {
    title: "Setup issue",
    description:
      "The agent couldn't find the required workflow. This is a platform issue — our team has been notified.",
    actionable: false,
  },
  bad_config: {
    title: "Configuration error",
    description:
      "There's a problem with the agent's configuration. Please contact support.",
    actionable: false,
  },
  auth_failed: {
    title: "Authentication failed",
    description:
      "The agent couldn't authenticate with the AI provider. Check your integration settings.",
    actionable: true,
  },
  // Agent errors
  prompt_too_long: {
    title: "Context limit exceeded",
    description:
      "The conversation exceeded the model's context window. Try breaking the task into smaller pieces.",
    actionable: true,
  },
};

const DEFAULT_ERROR: AgentErrorInfo = {
  title: "Something went wrong",
  description: "An unexpected error occurred. Our team has been notified.",
  actionable: false,
};

/** Resolve a machine-readable errorCode to a user-facing error message */
export const getAgentErrorInfo = (errorCode?: string): AgentErrorInfo => {
  if (!errorCode) return DEFAULT_ERROR;
  return AGENT_ERROR_MESSAGES[errorCode] ?? DEFAULT_ERROR;
};

/** Category-level fallback messages when no specific errorCode is available */
export const getCategoryFallback = (
  errorCategory?: "agent" | "infra" | "config" | "quota",
): AgentErrorInfo => {
  switch (errorCategory) {
    case "quota":
      return {
        title: "Rate limit",
        description: "The AI service is temporarily rate-limited.",
        actionable: false,
      };
    case "infra":
      return {
        title: "Infrastructure issue",
        description: "A temporary infrastructure problem occurred.",
        actionable: false,
      };
    case "config":
      return {
        title: "Configuration issue",
        description: "There's a configuration problem. Contact support.",
        actionable: false,
      };
    case "agent":
    default:
      return DEFAULT_ERROR;
  }
};

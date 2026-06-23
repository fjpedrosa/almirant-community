/**
 * Pure functions that gate whether a job should be marked as completed,
 * whether a PR should be marked as ready, and whether the session ended
 * due to a known failure pattern (e.g. context window exhaustion).
 *
 * ---------------------------------------------------------------------------
 * Runner-Implement Completion Contract Invariants:
 * ---------------------------------------------------------------------------
 *
 * INV-1: All tasks from wave.start MUST have matching wave.agent_done
 *        (pendingTaskIds.length === 0)
 *
 * INV-2: A terminal completion signal MUST be present. Valid signals are:
 *        - job.completed
 *        - a terminal structured ## Summary / ## Resumen block
 *        - deterministic side effects plus a clean session handoff
 *        (observedCompletionSignal === true)
 *
 * INV-3: ## Summary block MUST be present in text output or job.completed
 *        (structuredSummary !== undefined)
 *
 * INV-4 (hybrid): When the caller knows the set of work items the job was
 *        expected to complete (expectedWorkItemIds), every expected ID MUST
 *        appear in completedWorkItemIds. This is the deterministic check —
 *        derived from MCP side-effects (ai_sessions + board column moves),
 *        not from LLM-emitted markdown control tokens.
 *        Opt-in: if expectedWorkItemIds is omitted, this invariant is skipped.
 *
 * Recovery rules:
 *
 * REC-1: If backgroundAgentTimedOut BUT INV-1, INV-2, INV-3 are satisfied
 *        from session events, the job is COMPLETED (not failed).
 *        This handles the common case where the main session emitted all
 *        completion signals but the background agent poll timed out.
 *
 * REC-2: job.completed event implies INV-2.
 *        Receiving job.completed is a terminal success signal.
 *
 * REC-3: Text chunks (agent.text, agent.text.complete) are valid sources
 *        for INV-2 and INV-3 when they contain a structured summary block.
 *        Accumulated agent.text chunks are checked for ## Summary after all
 *        events are processed.
 *
 * REC-4: A terminal structured ## Summary / ## Resumen block counts as the
 *        completion signal. This covers recoverable delivery hiccups where
 *        the skill still emits the final summary.
 * ---------------------------------------------------------------------------
 */

import {
  DEFAULT_QUOTA_PAUSE_RETRY_MS,
  parseQuotaResetDelayMs,
} from "../shared/quota-pause";

import type { SessionEventRecord } from "@almirant/remote-agent";

export const CANONICAL_SKILL_PROGRESS_EVENT_KINDS = [
  "agent.step",
  "agent.question",
  "agent.permission.request",
  "agent.wave.start",
  "agent.wave.agent_done",
  "agent.wave.end",
  "agent.tool_call.start",
  "agent.tool_call.result",
  "agent.file.read",
  "agent.file.write",
  "agent.file.edit",
  "agent.bash.execute",
  "agent.bash.output",
  "agent.subagent.spawn",
  "agent.subagent.complete",
  "session.awaiting_user",
] as const;

export const RUNNER_IMPLEMENT_COMPLETION_EVENT_KINDS = [
  "agent.text",
  "agent.text.complete",
  "agent.summary",
  "agent.wave.start",
  "agent.wave.agent_done",
  "job.completed",
] as const;

// ---------------------------------------------------------------------------
// shouldMarkJobAsCompleted
// ---------------------------------------------------------------------------

interface JobCompletionInput {
  sessionSuccess: boolean;
  isPrFirstFlow: boolean;
  pushSucceeded: boolean;
  requiresPush?: boolean;
  requiresPullRequest?: boolean;
  hasPullRequest?: boolean;
  backgroundAgentTimedOut?: boolean;
  requiresStructuredSummary?: boolean;
  hasStructuredSummary?: boolean;
  hasPendingAgentTasks?: boolean;
  observedCompletionSignal?: boolean;
  /**
   * INV-4: when true, one or more expected work items never received a
   * complete_ai_task call. The job must NOT be marked as completed.
   */
  hasMissingWorkItems?: boolean;
}

/**
 * Determines whether the job should be marked as "completed".
 *
 * - Returns false if the session itself failed.
 * - Returns false if this is a PR-first flow and the push didn't succeed
 *   (the code never made it to the remote — marking complete would be a lie).
 * - Returns false if the job requires a push and the push didn't succeed.
 * - Returns false if the job requires a PR and no PR exists.
 * - Returns false when strict runner contracts were not satisfied.
 * - Returns true otherwise.
 *
 * Recovery rule REC-1: If backgroundAgentTimedOut is true but all three
 * invariants (INV-1, INV-2, INV-3) are satisfied, we ALLOW completion.
 * This handles the case where the main session finished cleanly but the
 * background agent poll exceeded its max wait time.
 */
export const shouldMarkJobAsCompleted = ({
  sessionSuccess,
  isPrFirstFlow,
  pushSucceeded,
  requiresPush = false,
  requiresPullRequest = false,
  hasPullRequest = false,
  backgroundAgentTimedOut = false,
  requiresStructuredSummary = false,
  hasStructuredSummary = false,
  hasPendingAgentTasks = false,
  observedCompletionSignal = true,
  hasMissingWorkItems = false,
}: JobCompletionInput): boolean => {
  if (!sessionSuccess) return false;
  if (hasMissingWorkItems) return false;

  // REC-1: Allow completion if background agent timed out BUT the canonical
  // completion contract (INV-1, INV-2, INV-3) is fully satisfied.
  // The contract is satisfied when:
  //   - observedCompletionSignal is true (INV-2)
  //   - hasPendingAgentTasks is false (INV-1)
  //   - hasStructuredSummary is true OR requiresStructuredSummary is false (INV-3)
  if (backgroundAgentTimedOut) {
    const contractSatisfied =
      observedCompletionSignal &&
      !hasPendingAgentTasks &&
      (!requiresStructuredSummary || hasStructuredSummary);
    if (!contractSatisfied) {
      return false;
    }
    // Contract is satisfied; continue with remaining checks
  }

  if (isPrFirstFlow && !pushSucceeded) return false;
  if (requiresPush && !pushSucceeded) return false;
  if (requiresPullRequest && !hasPullRequest) return false;
  if (requiresStructuredSummary && !hasStructuredSummary) return false;
  if (hasPendingAgentTasks) return false;
  if (!observedCompletionSignal) return false;
  return true;
};

// ---------------------------------------------------------------------------
// shouldMarkPrReady
// ---------------------------------------------------------------------------

interface PrReadyInput {
  sessionSuccess: boolean;
  pushSucceeded: boolean;
  prNumber: number | undefined | null;
  repoUrl: string | undefined | null;
  requiresStructuredSummary?: boolean;
  hasStructuredSummary?: boolean;
  backgroundAgentTimedOut?: boolean;
  hasPendingAgentTasks?: boolean;
  observedCompletionSignal?: boolean;
  /** INV-4: expected work items must all be covered by complete_ai_task. */
  hasMissingWorkItems?: boolean;
}

/**
 * Determines whether the draft PR should be marked as ready for review.
 * ALL required conditions must be truthy.
 *
 * Recovery rule REC-1 applies here as well: if backgroundAgentTimedOut but
 * the canonical completion contract is satisfied, the PR can still be marked ready.
 */
export const shouldMarkPrReady = ({
  sessionSuccess,
  pushSucceeded,
  prNumber,
  repoUrl,
  requiresStructuredSummary = false,
  hasStructuredSummary = false,
  backgroundAgentTimedOut = false,
  hasPendingAgentTasks = false,
  observedCompletionSignal = true,
  hasMissingWorkItems = false,
}: PrReadyInput): boolean => {
  if (!sessionSuccess || !pushSucceeded || !prNumber || !repoUrl) return false;
  if (hasMissingWorkItems) return false;

  // REC-1: Allow PR ready if background agent timed out BUT the canonical
  // completion contract is fully satisfied.
  if (backgroundAgentTimedOut) {
    const contractSatisfied =
      observedCompletionSignal &&
      !hasPendingAgentTasks &&
      (!requiresStructuredSummary || hasStructuredSummary);
    if (!contractSatisfied) {
      return false;
    }
    // Contract is satisfied; continue with remaining checks
  }

  if (requiresStructuredSummary && !hasStructuredSummary) return false;
  if (hasPendingAgentTasks) return false;
  if (!observedCompletionSignal) return false;
  return true;
};

// ---------------------------------------------------------------------------
// extractStructuredSummary / runner-implement canonical validation
// ---------------------------------------------------------------------------

// Accept both English and Spanish summary headings.
// Agents operating in locale "es" sometimes translate "## Summary" to "## Resumen".
const SUMMARY_MARKER = /^## (?:Summary|Resumen)\b/m;

export const extractStructuredSummary = (
  raw: string | undefined,
): string | undefined => {
  if (!raw) return undefined;
  const match = SUMMARY_MARKER.exec(raw);
  if (!match) return undefined;
  return raw.slice(match.index).trim();
};

type RunnerImplementValidationState = {
  structuredSummary?: string;
  observedCompletionSignal: boolean;
  /**
   * True when no explicit terminal event or structured summary was observed
   * in session events, but the hosting session handed control back cleanly and
   * deterministic invariants prove the runner completed its promised work.
   */
  sawImplicitCompletionSignal: boolean;
  pendingTaskIds: string[];
  /**
   * Expected work item IDs that were NOT covered by completedWorkItemIds
   * (i.e. no complete_ai_task MCP call observed for them). Empty array
   * when the hybrid check is skipped (no expectedWorkItemIds provided).
   */
  missingWorkItemIds: string[];
};

type RunnerImplementCanonicalInspection = {
  pendingTaskIds: string[];
  observedCompletionSignal: boolean;
  observedWaveSignals: boolean;
  summary?: string;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const summarySectionFromPayload = (payload: Record<string, unknown>): "Summary" | "Resumen" =>
  payload.section === "Resumen" ? "Resumen" : "Summary";

const SUMMARY_HEADING_REMAINDER_PATTERN =
  /^(?:de|of|for)\b|^[-—–:]\s*/i;

const buildStructuredSummaryFromAgentSummaryPayload = (
  payload: unknown,
): string | undefined => {
  if (!isRecord(payload)) return undefined;

  const rawText = typeof payload.text === "string" ? payload.text.trim() : "";
  if (!rawText) return undefined;

  const existingStructuredSummary = extractStructuredSummary(rawText);
  if (existingStructuredSummary) return existingStructuredSummary;

  const section = summarySectionFromPayload(payload);
  const [firstLine = "", ...restLines] = rawText.split(/\r?\n/);
  const firstLineTrimmed = firstLine.trim();
  const body = restLines.join("\n").trim();

  if (
    firstLineTrimmed &&
    SUMMARY_HEADING_REMAINDER_PATTERN.test(firstLineTrimmed)
  ) {
    return [`## ${section} ${firstLineTrimmed}`, body]
      .filter(Boolean)
      .join("\n\n");
  }

  return `## ${section}\n${rawText}`;
};

export const inspectRunnerImplementSessionEvents = (
  events: SessionEventRecord[] | undefined,
): RunnerImplementCanonicalInspection => {
  const pendingTaskIds = new Set<string>();
  let observedCompletionSignal = false;
  let observedWaveSignals = false;
  let summary: string | undefined;
  let accumulatedAgentText = "";

  for (const event of events ?? []) {
    switch (event.kind) {
      case "agent.text": {
        const content =
          isRecord(event.payload) && typeof event.payload.content === "string"
            ? event.payload.content
            : null;
        if (!content) break;
        accumulatedAgentText += content;
        break;
      }
      case "agent.text.complete": {
        const fullText =
          isRecord(event.payload) && typeof event.payload.fullText === "string"
            ? event.payload.fullText
            : null;
        if (!fullText) break;
        const structuredSummary = extractStructuredSummary(fullText);
        if (!summary && structuredSummary) {
          summary = structuredSummary;
        }
        if (structuredSummary) {
          observedCompletionSignal = true;
        }
        break;
      }
      case "agent.summary": {
        const structuredSummary = buildStructuredSummaryFromAgentSummaryPayload(
          event.payload,
        );
        if (!structuredSummary) break;
        if (!summary) {
          summary = structuredSummary;
        }
        observedCompletionSignal = true;
        break;
      }
      case "agent.wave.start": {
        observedWaveSignals = true;
        const agents = isRecord(event.payload) && Array.isArray(event.payload.agents)
          ? event.payload.agents
          : [];
        for (const agent of agents) {
          if (!isRecord(agent) || typeof agent.taskId !== "string") continue;
          pendingTaskIds.add(agent.taskId);
        }
        break;
      }
      case "agent.wave.agent_done": {
        observedWaveSignals = true;
        const taskId =
          isRecord(event.payload) && typeof event.payload.taskId === "string"
            ? event.payload.taskId
            : null;
        if (taskId) pendingTaskIds.delete(taskId);
        break;
      }
      case "job.completed": {
        observedCompletionSignal = true;
        if (isRecord(event.payload) && typeof event.payload.summary === "string") {
          summary = extractStructuredSummary(event.payload.summary) ?? event.payload.summary;
        }
        break;
      }
      default:
        break;
    }
  }

  if (!summary) {
    summary = extractStructuredSummary(accumulatedAgentText);
  }
  if (summary) {
    observedCompletionSignal = true;
  }

  return {
    pendingTaskIds: [...pendingTaskIds],
    observedCompletionSignal,
    observedWaveSignals,
    summary,
  };
};

type RunnerImplementValidationInput = {
  rawSummary?: string;
  /**
   * Optional transcript text used by runtime-specific adapters. This is NOT
   * part of the default contract because other coding agents already emit the
   * canonical session events/summary expected by the strict guard.
   */
  rawTranscript?: string;
  completionPolicy?: RunnerImplementCompletionPolicy;
  backgroundAgentTimedOut?: boolean;
  /**
   * True when the underlying agent runtime finished normally and handed the
   * turn back to Almirant. For runner-implement jobs with no user dialogue,
   * this can replace a missing terminal event only when deterministic side
   * effects also prove every expected work item was completed.
   */
  sessionTurnEndedCleanly?: boolean;
  sessionEvents?: SessionEventRecord[];
  /**
   * IDs of work items the job promised to complete. Resolved by the runner
   * from the leaf tasks of the root work item at job start (mirrors what
   * `get_implement_context` returns). Opt-in: omit to skip INV-4.
   */
  expectedWorkItemIds?: string[];
  /**
   * IDs of work items for which a `complete_ai_task` MCP call was observed
   * (i.e. ai_sessions row exists + board column is the review column).
   * This is the deterministic side-effect-based counterpart to the LLM's
   * markdown summary.
   */
  completedWorkItemIds?: string[];
};

export type RunnerImplementCompletionPolicy =
  | "strict-default"
  | "opencode-runner-implement";

type RunnerImplementValidationResult = RunnerImplementValidationState & {
  ok: boolean;
  completionState: "complete" | "incomplete" | "failed";
  reason?: string;
};

export const validateRunnerImplementCompletion = ({
  rawSummary,
  rawTranscript,
  completionPolicy = "strict-default",
  backgroundAgentTimedOut = false,
  sessionTurnEndedCleanly = false,
  sessionEvents,
  expectedWorkItemIds,
  completedWorkItemIds,
}: RunnerImplementValidationInput): RunnerImplementValidationResult => {
  const canonicalInspection = inspectRunnerImplementSessionEvents(sessionEvents);
  const completedSet = new Set(completedWorkItemIds ?? []);
  const missingWorkItemIds = expectedWorkItemIds
    ? expectedWorkItemIds.filter((id) => !completedSet.has(id))
    : [];
  const transcriptStructuredSummary =
    completionPolicy === "opencode-runner-implement"
      ? extractStructuredSummary(rawTranscript)
      : undefined;
  const structuredSummary =
    extractStructuredSummary(rawSummary) ??
    extractStructuredSummary(canonicalInspection.summary) ??
    canonicalInspection.summary ??
    transcriptStructuredSummary;
  const hasExpectedWorkItems =
    Array.isArray(expectedWorkItemIds) && expectedWorkItemIds.length > 0;
  const completedAllExpectedWorkItems =
    hasExpectedWorkItems && missingWorkItemIds.length === 0;
  const sawImplicitCompletionSignal =
    !canonicalInspection.observedCompletionSignal &&
    sessionTurnEndedCleanly &&
    !!structuredSummary &&
    canonicalInspection.pendingTaskIds.length === 0 &&
    completedAllExpectedWorkItems;
  const inspection: RunnerImplementValidationState = {
    structuredSummary,
    observedCompletionSignal:
      canonicalInspection.observedCompletionSignal ||
      !!transcriptStructuredSummary ||
      sawImplicitCompletionSignal,
    sawImplicitCompletionSignal,
    pendingTaskIds: canonicalInspection.pendingTaskIds,
    missingWorkItemIds,
  };
  const problems: string[] = [];
  const finishedCleanly =
    inspection.pendingTaskIds.length === 0 &&
    inspection.observedCompletionSignal &&
    !!inspection.structuredSummary &&
    missingWorkItemIds.length === 0;

  if (backgroundAgentTimedOut && !finishedCleanly && missingWorkItemIds.length === 0) {
    problems.push("background agent max wait exceeded");
  }
  if (inspection.pendingTaskIds.length > 0) {
    problems.push(`pending tasks remained: ${inspection.pendingTaskIds.join(", ")}`);
  }
  if (!inspection.observedCompletionSignal) {
    problems.push("missing completion signal");
  }
  if (!inspection.structuredSummary) {
    problems.push("missing ## Summary block");
  }
  if (missingWorkItemIds.length > 0) {
    problems.push(
      `${missingWorkItemIds.length} expected tasks missing complete_ai_task: ${missingWorkItemIds.join(", ")}`,
    );
  }

  if (problems.length === 0) {
    return {
      ok: true,
      completionState: "complete",
      ...inspection,
    };
  }

  const onlyMissingWorkItems =
    missingWorkItemIds.length > 0 &&
    inspection.pendingTaskIds.length === 0 &&
    inspection.observedCompletionSignal &&
    !!inspection.structuredSummary &&
    problems.length === 1;

  return {
    ok: false,
    completionState: onlyMissingWorkItems ? "incomplete" : "failed",
    reason: `runner-implement did not finish cleanly: ${problems.join("; ")}`,
    ...inspection,
  };
};

// ---------------------------------------------------------------------------
// detectKnownFailurePatterns
// ---------------------------------------------------------------------------

interface FailurePatternResult {
  reason: string;
  pattern: string;
  /** When true, the job should be re-queued with a delay instead of failed permanently. */
  retryable?: boolean;
  /** Suggested delay in ms before the next attempt (only meaningful when retryable is true). */
  retryDelayMs?: number;
}

const DEFAULT_RATE_LIMIT_RETRY_MS = DEFAULT_QUOTA_PAUSE_RETRY_MS;

/**
 * Parse a reset-time string from a subscription limit message and return
 * the delay in ms from now until that time.
 *
 * Supported formats:
 *   - "resets 7pm (UTC)"  / "resets 10am (UTC)"  → absolute UTC time
 *   - "resets in 21m"                             → relative minutes
 */
const parseResetDelay = (text: string): number | undefined => {
  return parseQuotaResetDelayMs(text);
};

const KNOWN_PATTERNS: Array<{
  test: (text: string) => boolean;
  reason: string;
  pattern: string;
  retryable?: boolean;
  getRetryDelayMs?: (text: string) => number | undefined;
}> = [
  {
    test: (text) => /prompt is too long/i.test(text),
    reason: "Session ended due to context window exhaustion",
    pattern: "prompt_too_long",
  },
  {
    test: (text) => /you've hit your limit/i.test(text),
    reason: "Session hit subscription rate limit",
    pattern: "subscription_limit",
    retryable: true,
    getRetryDelayMs: parseResetDelay,
  },
  {
    test: (text) => /\b429\b/.test(text) && /too many requests/i.test(text),
    reason: "Session hit API rate limit",
    pattern: "rate_limit",
    retryable: true,
    getRetryDelayMs: () => DEFAULT_RATE_LIMIT_RETRY_MS,
  },
  {
    test: (text) => /\b529\b/.test(text) && /overloaded/i.test(text),
    reason: "Session hit API overloaded error",
    pattern: "api_overloaded",
    retryable: true,
    getRetryDelayMs: () => DEFAULT_RATE_LIMIT_RETRY_MS,
  },
  {
    test: (text) =>
      /\b401\b/.test(text) &&
      /authentication_error|invalid authentication credentials/i.test(text),
    reason: "Session hit API authentication error (401)",
    pattern: "authentication_error",
    retryable: true,
    getRetryDelayMs: () => DEFAULT_RATE_LIMIT_RETRY_MS,
  },
];

/**
 * Scans the last assistant message for known failure patterns that the AI
 * session may have reported as its final output. Returns the first match,
 * or null if none found.
 */
export const detectKnownFailurePatterns = (
  lastAssistantText: string
): FailurePatternResult | null => {
  for (const { test, reason, pattern, retryable, getRetryDelayMs } of KNOWN_PATTERNS) {
    if (test(lastAssistantText)) {
      const retryDelayMs = getRetryDelayMs?.(lastAssistantText) ?? (retryable ? DEFAULT_RATE_LIMIT_RETRY_MS : undefined);
      return { reason, pattern, retryable, retryDelayMs };
    }
  }
  return null;
};

// ---------------------------------------------------------------------------
// detectSessionEventFailures
// ---------------------------------------------------------------------------

/**
 * Scans `agent.text.complete` session events for known failure patterns.
 *
 * Background subagents run as separate processes whose output appears as
 * `agent.text.complete` events in the canonical session stream — NOT in the
 * main agent's `lastAssistantText`.  When subagents crash (e.g. 401 auth
 * errors, rate limits), the failure is only visible here.
 */
export const detectSessionEventFailures = (
  sessionEvents: SessionEventRecord[] | undefined,
): FailurePatternResult | null => {
  for (const event of sessionEvents ?? []) {
    if (event.kind !== "agent.text.complete") continue;
    const fullText =
      isRecord(event.payload) && typeof event.payload.fullText === "string"
        ? event.payload.fullText
        : null;
    if (!fullText) continue;
    const match = detectKnownFailurePatterns(fullText);
    if (match) return match;
  }
  return null;
};

// ---------------------------------------------------------------------------
// detectNoSkillProgress
// ---------------------------------------------------------------------------

const CANONICAL_SKILL_PROGRESS_EVENT_KIND_SET = new Set<string>(CANONICAL_SKILL_PROGRESS_EVENT_KINDS);

/**
 * Detects when an AI session completed without producing any canonical skill
 * progress events. This typically means the skill was not recognized by the
 * agent (e.g. the skill file is missing from the repo).
 *
 * Only triggers for short sessions (< 90s) to avoid false positives on
 * legitimate sessions that complete without rich progress events.
 *
 * Skipped entirely for retry attempts — a retry may inherit a workspace
 * state that causes it to finish quickly without progress events, and the first
 * attempt already validated that the skill exists.
 */
export const detectNoSkillProgress = (
  lastAssistantText: string,
  durationMs: number,
  retryCount: number = 0,
  sessionEvents?: SessionEventRecord[],
): FailurePatternResult | null => {
  if (retryCount > 0) return null;
  const MAX_DURATION_FOR_CHECK_MS = 90_000;
  if (durationMs > MAX_DURATION_FOR_CHECK_MS) return null;
  const observedCanonicalProgress = (sessionEvents ?? []).some((event) =>
    CANONICAL_SKILL_PROGRESS_EVENT_KIND_SET.has(event.kind)
  );
  if (observedCanonicalProgress) {
    return null;
  }

  if (!lastAssistantText || lastAssistantText.trim().length === 0) {
    return {
      reason: "Session completed with no output — skill may not exist or failed to start",
      pattern: "no_skill_output",
    };
  }
  return {
    reason: "Session completed without canonical progress events — skill may not have been recognized",
    pattern: "no_skill_progress",
  };
};

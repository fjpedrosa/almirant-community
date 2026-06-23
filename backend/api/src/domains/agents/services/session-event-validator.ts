/**
 * Validates the structural integrity of session events required for completion
 * evaluation. Used to detect missing critical events, ordering anomalies, and
 * sequence gaps before the completion-evaluator consumes them.
 *
 * This module operates on the same event kinds defined in
 * RUNNER_IMPLEMENT_COMPLETION_EVENT_KINDS from job-completion-guards.ts:
 *   - agent.text
 *   - agent.text.complete
 *   - agent.wave.start
 *   - agent.wave.agent_done
 *   - job.completed
 */

export type SessionEventRecord = {
  sequenceNum: number;
  kind: string;
  payload: Record<string, unknown> | null;
  provider?: string | null;
  createdAt?: string;
};

export type CompletionEventIntegrityResult = {
  isComplete: boolean;
  missingKinds: string[];
  warnings: string[];
};

/**
 * Completion-relevant event kinds that MUST be present for a complete session.
 * These align with RUNNER_IMPLEMENT_COMPLETION_EVENT_KINDS.
 */
const CRITICAL_TERMINAL_KINDS = [
  "agent.text.complete",
  "job.completed",
] as const;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/**
 * Validates that a set of session events contains all critical events
 * needed for the completion contract.
 *
 * Checks:
 * 1. Terminal events (agent.text.complete, job.completed) are present
 * 2. Wave tasks from agent.wave.start have matching agent.wave.agent_done
 * 3. If agent.text chunks exist, agent.text.complete must also exist
 * 4. sequenceNums are monotonically increasing
 * 5. No gaps in sequence numbers (warning only)
 */
export const validateCompletionEventIntegrity = (
  events: SessionEventRecord[],
): CompletionEventIntegrityResult => {
  const missingKinds: string[] = [];
  const warnings: string[] = [];

  if (events.length === 0) {
    return {
      isComplete: false,
      missingKinds: [...CRITICAL_TERMINAL_KINDS],
      warnings: ["No events provided"],
    };
  }

  // Collect present kinds
  const presentKinds = new Set(events.map((e) => e.kind));

  // Check for critical terminal events
  for (const kind of CRITICAL_TERMINAL_KINDS) {
    if (!presentKinds.has(kind)) {
      missingKinds.push(kind);
    }
  }

  // Check agent.text -> agent.text.complete consistency
  if (presentKinds.has("agent.text") && !presentKinds.has("agent.text.complete")) {
    if (!missingKinds.includes("agent.text.complete")) {
      missingKinds.push("agent.text.complete");
    }
    warnings.push(
      "agent.text chunks exist but no agent.text.complete terminal event was found",
    );
  }

  // Check wave task matching: every task from agent.wave.start should
  // have a corresponding agent.wave.agent_done
  const startedTaskIds = new Set<string>();
  const completedTaskIds = new Set<string>();

  for (const event of events) {
    if (event.kind === "agent.wave.start") {
      const agents =
        isRecord(event.payload) && Array.isArray(event.payload.agents)
          ? event.payload.agents
          : [];
      for (const agent of agents) {
        if (isRecord(agent) && typeof agent.taskId === "string") {
          startedTaskIds.add(agent.taskId);
        }
      }
    }
    if (event.kind === "agent.wave.agent_done") {
      const taskId =
        isRecord(event.payload) && typeof event.payload.taskId === "string"
          ? event.payload.taskId
          : null;
      if (taskId) {
        completedTaskIds.add(taskId);
      }
    }
  }

  const unmatchedTaskIds: string[] = [];
  for (const taskId of startedTaskIds) {
    if (!completedTaskIds.has(taskId)) {
      unmatchedTaskIds.push(taskId);
    }
  }
  if (unmatchedTaskIds.length > 0) {
    warnings.push(
      `Unmatched wave tasks (started but not done): ${unmatchedTaskIds.join(", ")}`,
    );
  }

  // Check ordering: sequenceNums should be monotonically increasing
  let isMonotonic = true;
  for (let i = 1; i < events.length; i++) {
    const current = events[i];
    const prev = events[i - 1];
    if (!current || !prev) continue;
    if (current.sequenceNum <= prev.sequenceNum) {
      isMonotonic = false;
      warnings.push(
        `Out-of-order events: sequenceNum ${current.sequenceNum} at index ${i} is not greater than ${prev.sequenceNum} at index ${i - 1}`,
      );
      break; // Report only the first ordering violation
    }
  }

  // Check for sequence gaps (only if monotonic -- otherwise gaps are meaningless)
  if (isMonotonic && events.length >= 2) {
    const sequenceNums = events.map((e) => e.sequenceNum);
    const min = sequenceNums[0] ?? 0;
    const max = sequenceNums[sequenceNums.length - 1] ?? 0;
    const expectedCount = max - min + 1;
    if (events.length < expectedCount) {
      const gapCount = expectedCount - events.length;
      warnings.push(
        `Sequence gaps detected: ${gapCount} missing sequence number(s) between ${min} and ${max}`,
      );
    }
  }

  // isComplete means no critical kinds are missing
  const isComplete = missingKinds.length === 0;

  return {
    isComplete,
    missingKinds,
    warnings,
  };
};

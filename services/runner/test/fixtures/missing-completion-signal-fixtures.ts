/**
 * Fixtures for the "missing completion signal" scenario.
 *
 * These synthetic fixtures reproduce inconsistent completion behavior in the
 * runner-implement skill.
 *
 * Each fixture documents:
 *   - description: What scenario is being reproduced
 *   - invariantBroken: The specific contract violation
 *   - events: Array of SessionEventRecord objects
 *   - expectedResult: What inspectRunnerImplementSessionEvents should return
 */

import type { SessionEventRecord } from "@almirant/remote-agent";

/**
 * Shape of each fixture in the missing-completion-signal cluster.
 */
export type MissingCompletionSignalFixture = {
  /** Human-readable description of the scenario. */
  description: string;
  /** The specific contract invariant that this fixture violates. */
  invariantBroken: string;
  /** Anonymized session events that reproduce the bug. */
  events: SessionEventRecord[];
  /** Expected result from inspectRunnerImplementSessionEvents(). */
  expectedResult: {
    observedCompletionSignal: boolean;
    pendingTaskIds: string[];
    observedWaveSignals: boolean;
    hasSummary: boolean;
  };
};

// ---------------------------------------------------------------------------
// Fixture 1: Transcript has summary but job times out
// ---------------------------------------------------------------------------

/**
 * Scenario: The agent output contains ## Summary in the text
 * chunks, and all wave tasks completed successfully. However, the
 * `job.completed` event was never emitted before the background agent
 * timeout fired. This simulates a race condition where the orchestrator
 * kills the job prematurely.
 *
 * Invariant broken: job timed out before job.completed event was emitted,
 * despite ## Summary being present in the transcript.
 */
const transcriptHasSummaryButJobFails: MissingCompletionSignalFixture = {
  description:
    "Session events where ## Summary exist in streamed text, " +
    "all wave tasks completed, but no job.completed event was emitted " +
    "before background agent timeout",
  invariantBroken:
    "job timed out before job.completed event was emitted, despite  " +
    "and ## Summary being present in the transcript",
  events: [
    {
      sequenceNum: 1,
      kind: "agent.wave.start",
      payload: {
        agents: [
          { agent: "frontend-developer", taskId: "TASK-001", title: "Implement user form validation" },
          { agent: "backend-architect", taskId: "TASK-002", title: "Add API endpoint for submissions" },
        ],
      },
      createdAt: "2026-04-15T10:00:00.000Z",
    },
    {
      sequenceNum: 2,
      kind: "agent.text",
      payload: { content: "Starting implementation for TASK-001..." },
      createdAt: "2026-04-15T10:00:05.000Z",
    },
    {
      sequenceNum: 3,
      kind: "agent.text",
      payload: { content: "\n\nForm validation logic added. Moving to backend." },
      createdAt: "2026-04-15T10:02:30.000Z",
    },
    {
      sequenceNum: 4,
      kind: "agent.wave.agent_done",
      payload: { agent: "frontend-developer", taskId: "TASK-001", success: true },
      createdAt: "2026-04-15T10:02:35.000Z",
    },
    {
      sequenceNum: 5,
      kind: "agent.text",
      payload: { content: "\n\nBackend endpoint implemented and tested." },
      createdAt: "2026-04-15T10:05:00.000Z",
    },
    {
      sequenceNum: 6,
      kind: "agent.wave.agent_done",
      payload: { agent: "backend-architect", taskId: "TASK-002", success: true },
      createdAt: "2026-04-15T10:05:05.000Z",
    },
    {
      sequenceNum: 7,
      kind: "agent.text",
      payload: { content: "\n\n All tasks completed successfully.\n\n" },
      createdAt: "2026-04-15T10:05:10.000Z",
    },
    {
      sequenceNum: 8,
      kind: "agent.text",
      payload: {
        content:
          "## Summary\n\n" +
          "**Total**: 2 | **Completed**: 2\n\n" +
          "- TASK-001: Added form validation with Zod schema\n" +
          "- TASK-002: Created POST /api/submissions endpoint\n",
      },
      createdAt: "2026-04-15T10:05:15.000Z",
    },
    {
      sequenceNum: 9,
      kind: "agent.text.complete",
      payload: {
        fullText:
          "Starting implementation for TASK-001...\n\n" +
          "Form validation logic added. Moving to backend.\n\n" +
          "Backend endpoint implemented and tested.\n\n" +
          " All tasks completed successfully.\n\n" +
          "## Summary\n\n" +
          "**Total**: 2 | **Completed**: 2\n\n" +
          "- TASK-001: Added form validation with Zod schema\n" +
          "- TASK-002: Created POST /api/submissions endpoint\n",
      },
      createdAt: "2026-04-15T10:05:20.000Z",
    },
    // NOTE: No job.completed event — this is the bug!
    // The orchestrator timed out waiting for background agents even though
    // the text output clearly indicates completion.
  ],
  expectedResult: {
    observedCompletionSignal: true, // From summary in text
    pendingTaskIds: [],
    observedWaveSignals: true,
    hasSummary: true,
  },
};

// ---------------------------------------------------------------------------
// Fixture 2: Partial wave completion with job.completed
// ---------------------------------------------------------------------------

/**
 * Scenario: A wave started with 3 tasks, but only 2 emitted agent_done
 * events. Despite this, job.completed was still emitted. This represents
 * a contract inconsistency where the orchestrator claims completion while
 * tasks remain pending.
 *
 * Invariant broken: pendingTaskIds not cleared, but job.completed emitted.
 */
const partialWaveCompletion: MissingCompletionSignalFixture = {
  description:
    "Session events where a wave starts with 3 tasks, only 2 complete, " +
    "but job.completed is emitted anyway — contract inconsistency",
  invariantBroken:
    "pendingTaskIds not cleared, but job.completed emitted — contract inconsistency",
  events: [
    {
      sequenceNum: 1,
      kind: "agent.wave.start",
      payload: {
        agents: [
          { agent: "frontend-developer", taskId: "TASK-101", title: "Update dashboard layout" },
          { agent: "backend-architect", taskId: "TASK-102", title: "Refactor API response" },
          { agent: "database-optimizer", taskId: "TASK-103", title: "Add database index" },
        ],
      },
      createdAt: "2026-04-15T11:00:00.000Z",
    },
    {
      sequenceNum: 2,
      kind: "agent.text",
      payload: { content: "Processing dashboard updates..." },
      createdAt: "2026-04-15T11:00:10.000Z",
    },
    {
      sequenceNum: 3,
      kind: "agent.wave.agent_done",
      payload: { agent: "frontend-developer", taskId: "TASK-101", success: true },
      createdAt: "2026-04-15T11:03:00.000Z",
    },
    {
      sequenceNum: 4,
      kind: "agent.text",
      payload: { content: "\n\nAPI response refactored with proper typing." },
      createdAt: "2026-04-15T11:05:00.000Z",
    },
    {
      sequenceNum: 5,
      kind: "agent.wave.agent_done",
      payload: { agent: "backend-architect", taskId: "TASK-102", success: true },
      createdAt: "2026-04-15T11:05:05.000Z",
    },
    // NOTE: TASK-103 (database-optimizer) never emits agent_done!
    // This could happen if the subagent crashes or times out silently.
    {
      sequenceNum: 6,
      kind: "agent.text",
      payload: { content: "\n\n Implementation complete.\n\n" },
      createdAt: "2026-04-15T11:06:00.000Z",
    },
    {
      sequenceNum: 7,
      kind: "agent.text.complete",
      payload: {
        fullText:
          "Processing dashboard updates...\n\n" +
          "API response refactored with proper typing.\n\n" +
          " Implementation complete.\n\n" +
          "## Summary\n\n" +
          "**Total**: 3 | **Completed**: 2\n\n" +
          "- TASK-101: Dashboard layout updated\n" +
          "- TASK-102: API response types fixed\n" +
          "- TASK-103: (pending)\n",
      },
      createdAt: "2026-04-15T11:06:05.000Z",
    },
    {
      sequenceNum: 8,
      kind: "job.completed",
      payload: {
        summary:
          "## Summary\n\n" +
          "**Total**: 3 | **Completed**: 2\n\n" +
          "- TASK-101: Dashboard layout updated\n" +
          "- TASK-102: API response types fixed\n" +
          "- TASK-103: (pending)\n",
      },
      createdAt: "2026-04-15T11:06:10.000Z",
    },
  ],
  expectedResult: {
    observedCompletionSignal: true, // job.completed sets this
    pendingTaskIds: ["TASK-103"], // Database task never completed
    observedWaveSignals: true,
    hasSummary: true,
  },
};

// ---------------------------------------------------------------------------
// Fixture 3: Summary exists only in text chunks
// ---------------------------------------------------------------------------

/**
 * Scenario: The ## Summary block exist only within
 * streamed agent.text chunks. There is no agent.text.complete event
 * and no job.completed event. All wave tasks completed. This can happen
 * when the agent crashes immediately after emitting the last text chunk.
 *
 * Invariant broken: completion signals exist only in streamed text chunks,
 * not in terminal events.
 */
const summaryInTextChunksOnly: MissingCompletionSignalFixture = {
  description:
    "Session events where ## Summary exist only in agent.text " +
    "chunks, with no agent.text.complete or job.completed events",
  invariantBroken:
    "completion signals exist only in streamed text chunks, not in terminal events",
  events: [
    {
      sequenceNum: 1,
      kind: "agent.wave.start",
      payload: {
        agents: [
          { agent: "general-purpose", taskId: "TASK-201", title: "Fix authentication bug" },
        ],
      },
      createdAt: "2026-04-15T12:00:00.000Z",
    },
    {
      sequenceNum: 2,
      kind: "agent.text",
      payload: { content: "Analyzing authentication flow..." },
      createdAt: "2026-04-15T12:00:10.000Z",
    },
    {
      sequenceNum: 3,
      kind: "agent.text",
      payload: { content: "\n\nFound issue: token validation missing." },
      createdAt: "2026-04-15T12:01:00.000Z",
    },
    {
      sequenceNum: 4,
      kind: "agent.text",
      payload: { content: "\n\nFixed token validation in auth middleware." },
      createdAt: "2026-04-15T12:02:30.000Z",
    },
    {
      sequenceNum: 5,
      kind: "agent.wave.agent_done",
      payload: { agent: "general-purpose", taskId: "TASK-201", success: true },
      createdAt: "2026-04-15T12:02:35.000Z",
    },
    {
      sequenceNum: 6,
      kind: "agent.text",
      payload: { content: "\n\n\n\n## Summary\n\n" },
      createdAt: "2026-04-15T12:02:40.000Z",
    },
    {
      sequenceNum: 7,
      kind: "agent.text",
      payload: {
        content:
          "**Total**: 1 | **Completed**: 1\n\n" +
          "- TASK-201: Added proper JWT validation to auth middleware\n",
      },
      createdAt: "2026-04-15T12:02:45.000Z",
    },
    // NOTE: No agent.text.complete and no job.completed events
    // The session may have been killed before these could be emitted.
  ],
  expectedResult: {
    observedCompletionSignal: true, // Summary was detected from accumulated text chunks
    pendingTaskIds: [],
    observedWaveSignals: true,
    hasSummary: true, // ## Summary found in accumulated text
  },
};

// ---------------------------------------------------------------------------
// Fixture 4: Wave signals present but  split across chunks
// ---------------------------------------------------------------------------

/**
 * Scenario: The ## Summary heading is split across multiple agent.text chunks. This tests the accumulator
 * logic that must reconstruct the structured summary from partial chunks.
 *
 * This is a regression test for a bug where summary detection only looked at individual chunks
 * rather than the accumulated text.
 */
const summarySplitAcrossChunks: MissingCompletionSignalFixture = {
  description:
    "Session events where the structured summary is split across multiple " +
    "agent.text chunks, requiring accumulation to detect completion",
  invariantBroken:
    "detection logic must accumulate chunks to find the structured summary — " +
    "per-chunk inspection would miss it",
  events: [
    {
      sequenceNum: 1,
      kind: "agent.wave.start",
      payload: {
        agents: [
          { agent: "javascript-pro", taskId: "TASK-301", title: "Optimize bundle size" },
        ],
      },
      createdAt: "2026-04-15T13:00:00.000Z",
    },
    {
      sequenceNum: 2,
      kind: "agent.text",
      payload: { content: "Analyzing webpack configuration..." },
      createdAt: "2026-04-15T13:00:10.000Z",
    },
    {
      sequenceNum: 3,
      kind: "agent.text",
      payload: { content: "\n\nRemoved unused dependencies.\n\n## Sum" },
      createdAt: "2026-04-15T13:03:00.000Z",
    },
    {
      sequenceNum: 4,
      kind: "agent.wave.agent_done",
      payload: { agent: "javascript-pro", taskId: "TASK-301", success: true },
      createdAt: "2026-04-15T13:03:05.000Z",
    },
    {
      sequenceNum: 5,
      kind: "agent.text",
      payload: { content: "mary\n\nBundle size reduced by 40%.\n\n" },
      createdAt: "2026-04-15T13:03:10.000Z",
    },
    {
      sequenceNum: 6,
      kind: "agent.text",
      payload: {
        content:
          "**Total**: 1 | **Completed**: 1\n\n" +
          "- TASK-301: Removed 5 unused packages, enabled tree-shaking\n",
      },
      createdAt: "2026-04-15T13:03:15.000Z",
    },
    {
      sequenceNum: 7,
      kind: "agent.text.complete",
      payload: {
        fullText:
          "Analyzing webpack configuration...\n\n" +
          "Removed unused dependencies.\n\n" +
          "## Summary\n\n" +
          "Bundle size reduced by 40%.\n\n" +
          "**Total**: 1 | **Completed**: 1\n\n" +
          "- TASK-301: Removed 5 unused packages, enabled tree-shaking\n",
      },
      createdAt: "2026-04-15T13:03:20.000Z",
    },
    {
      sequenceNum: 8,
      kind: "job.completed",
      payload: {
        summary:
          "## Summary\n\n" +
          "**Total**: 1 | **Completed**: 1\n\n" +
          "- TASK-301: Removed 5 unused packages, enabled tree-shaking\n",
      },
      createdAt: "2026-04-15T13:03:25.000Z",
    },
  ],
  expectedResult: {
    observedCompletionSignal: true, // Must be detected from split summary chunks
    pendingTaskIds: [],
    observedWaveSignals: true,
    hasSummary: true,
  },
};

// ---------------------------------------------------------------------------
// Fixture 5: No wave signals, only text completion
// ---------------------------------------------------------------------------

/**
 * Scenario: A simple job with no wave events — the agent processes a
 * single task directly without spawning subagents. This represents
 * the baseline behavior where only text events carry completion signals.
 *
 * This is NOT a bug scenario but establishes baseline behavior.
 */
const noWaveSignalsTextOnly: MissingCompletionSignalFixture = {
  description:
    "Session events with no wave signals — single-agent execution " +
    "with completion signals only in text events",
  invariantBroken:
    "none — this fixture establishes baseline behavior for non-wave jobs",
  events: [
    {
      sequenceNum: 1,
      kind: "agent.text",
      payload: { content: "Processing request directly without subagents." },
      createdAt: "2026-04-15T14:00:00.000Z",
    },
    {
      sequenceNum: 2,
      kind: "agent.text",
      payload: { content: "\n\nTask completed.\n\n\n\n" },
      createdAt: "2026-04-15T14:01:00.000Z",
    },
    {
      sequenceNum: 3,
      kind: "agent.text",
      payload: {
        content:
          "## Summary\n\n" +
          "Single-task job completed without wave orchestration.\n",
      },
      createdAt: "2026-04-15T14:01:05.000Z",
    },
    {
      sequenceNum: 4,
      kind: "agent.text.complete",
      payload: {
        fullText:
          "Processing request directly without subagents.\n\n" +
          "Task completed.\n\n\n\n" +
          "## Summary\n\n" +
          "Single-task job completed without wave orchestration.\n",
      },
      createdAt: "2026-04-15T14:01:10.000Z",
    },
    {
      sequenceNum: 5,
      kind: "job.completed",
      payload: {
        summary:
          "## Summary\n\n" +
          "Single-task job completed without wave orchestration.\n",
      },
      createdAt: "2026-04-15T14:01:15.000Z",
    },
  ],
  expectedResult: {
    observedCompletionSignal: true,
    pendingTaskIds: [],
    observedWaveSignals: false, // No wave events
    hasSummary: true,
  },
};

// ---------------------------------------------------------------------------
// Export all fixtures
// ---------------------------------------------------------------------------

/**
 * Collection of all missing-completion-signal fixtures.
 *
 * Usage:
 * ```typescript
 * import { missingCompletionSignalFixtures } from "./missing-completion-signal-fixtures";
 *
 * // Access individual fixtures
 * const events = missingCompletionSignalFixtures.transcriptHasSummaryButJobFails.events;
 *
 * // Or iterate all fixtures
 * for (const [name, fixture] of Object.entries(missingCompletionSignalFixtures)) {
 *   // ...
 * }
 * ```
 */
export const missingCompletionSignalFixtures = {
  /**
   * Fixture 1: Transcript has summary but job times out.
   * Bug: job.completed never emitted despite successful output.
   */
  transcriptHasSummaryButJobFails,

  /**
   * Fixture 2: Partial wave completion with job.completed.
   * Bug: Contract inconsistency — pendingTaskIds not cleared.
   */
  partialWaveCompletion,

  /**
   * Fixture 3: Summary exists only in text chunks.
   * Bug: No terminal events despite completion signals in text.
   */
  summaryInTextChunksOnly,

  /**
   * Fixture 4: structured summary split across text chunks.
   * Regression test: Accumulator must detect split structured summaries.
   */
  summarySplitAcrossChunks,

  /**
   * Fixture 5: No wave signals, text-only completion.
   * Baseline: Establishes expected behavior for non-wave jobs.
   */
  noWaveSignalsTextOnly,
} as const;

/**
 * Helper type for iterating over fixture names.
 */
export type MissingCompletionSignalFixtureName =
  keyof typeof missingCompletionSignalFixtures;

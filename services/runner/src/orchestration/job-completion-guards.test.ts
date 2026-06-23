import { describe, expect, it } from "bun:test";
import {
  CANONICAL_SKILL_PROGRESS_EVENT_KINDS,
  RUNNER_IMPLEMENT_COMPLETION_EVENT_KINDS,
  extractStructuredSummary,
  detectNoSkillProgress,
  inspectRunnerImplementSessionEvents,
  shouldMarkJobAsCompleted,
  shouldMarkPrReady,
  validateRunnerImplementCompletion,
} from "./job-completion-guards";

describe("extractStructuredSummary", () => {
  it("returns undefined when the transcript does not contain a summary block", () => {
    expect(extractStructuredSummary(" Working\n Finished")).toBeUndefined();
  });

  it("returns only the ## Summary block", () => {
    const transcript = [
      " Working",
      " Implementation completed",
      "## Summary",
      "- Updated the runner",
      "- Added guards",
      "",
      "Trailing detail",
    ].join("\n");

    expect(extractStructuredSummary(transcript)).toBe([
      "## Summary",
      "- Updated the runner",
      "- Added guards",
      "",
      "Trailing detail",
    ].join("\n"));
  });

  it("returns the ## Resumen block (Spanish locale)", () => {
    const transcript = [
      " Todas las tareas completadas",
      "",
      "## Resumen de Implementación — A-F-393",
      "**Total**: 14 | **Completed**: 9",
    ].join("\n");

    expect(extractStructuredSummary(transcript)).toBe([
      "## Resumen de Implementación — A-F-393",
      "**Total**: 14 | **Completed**: 9",
    ].join("\n"));
  });
});

describe("validateRunnerImplementCompletion", () => {
  it("fails when background agents timed out", () => {
    const result = validateRunnerImplementCompletion({
      rawSummary: "Still running",
      backgroundAgentTimedOut: true,
    });

    expect(result.ok).toBe(false);
    expect(result.reason).toContain("background agent max wait exceeded");
  });

  it("fails when completion events or ## Summary are missing", () => {
    const result = validateRunnerImplementCompletion({
      rawSummary: "Plain text without summary",
      sessionEvents: [
        {
          sequenceNum: 1,
          kind: "agent.wave.start",
          payload: {
            agents: [
              { agent: "frontend-developer", taskId: "A-1", title: "Task one" },
              { agent: "backend-architect", taskId: "A-2", title: "Task two" },
            ],
          },
        },
        {
          sequenceNum: 2,
          kind: "agent.wave.agent_done",
          payload: { agent: "frontend-developer", taskId: "A-1", success: true },
        },
      ],
    });

    expect(result.ok).toBe(false);
    expect(result.reason).toContain("pending tasks remained: A-2");
    expect(result.reason).toContain("missing completion signal");
    expect(result.reason).toContain("missing ## Summary block");
  });

  it("uses transcript summary only for the OpenCode runner-implement policy", () => {
    const strictResult = validateRunnerImplementCompletion({
      rawSummary: "completed",
      rawTranscript: "## Summary\n- Finished via transcript",
      sessionTurnEndedCleanly: true,
      expectedWorkItemIds: ["wi-1"],
      completedWorkItemIds: ["wi-1"],
    });

    expect(strictResult.ok).toBe(false);
    expect(strictResult.reason).toContain("missing completion signal");
    expect(strictResult.reason).toContain("missing ## Summary block");

    const opencodeResult = validateRunnerImplementCompletion({
      rawSummary: "completed",
      rawTranscript: "## Summary\n- Finished via transcript",
      completionPolicy: "opencode-runner-implement",
      sessionTurnEndedCleanly: true,
      expectedWorkItemIds: ["wi-1"],
      completedWorkItemIds: ["wi-1"],
    });

    expect(opencodeResult.ok).toBe(true);
    expect(opencodeResult.observedCompletionSignal).toBe(true);
    expect(opencodeResult.sawImplicitCompletionSignal).toBe(true);
    expect(opencodeResult.structuredSummary).toBe(
      "## Summary\n- Finished via transcript",
    );
  });

  it("passes when canonical completion already finished cleanly before a background timeout", () => {
    const result = validateRunnerImplementCompletion({
      rawSummary: "## Summary\n- Completed A-1",
      backgroundAgentTimedOut: true,
      sessionEvents: [
        {
          sequenceNum: 1,
          kind: "agent.wave.start",
          payload: {
            agents: [{ agent: "frontend-developer", taskId: "A-1", title: "Task one" }],
          },
        },
        {
          sequenceNum: 2,
          kind: "agent.wave.agent_done",
          payload: { agent: "frontend-developer", taskId: "A-1", success: true },
        },
        {
          sequenceNum: 3,
          kind: "job.completed",
          payload: { summary: "## Summary\n- Completed A-1" },
        },
      ],
    });

    expect(result.ok).toBe(true);
    expect(result.pendingTaskIds).toEqual([]);
    expect(result.observedCompletionSignal).toBe(true);
    expect(result.structuredSummary).toBe("## Summary\n- Completed A-1");
  });

  it("recovers completion from plain text chunks and agent.text.complete", () => {
    const result = validateRunnerImplementCompletion({
      backgroundAgentTimedOut: true,
      sessionEvents: [
        {
          sequenceNum: 1,
          kind: "agent.wave.start",
          payload: {
            agents: [{ agent: "frontend-developer", taskId: "A-1", title: "Task one" }],
          },
        },
        {
          sequenceNum: 2,
          kind: "agent.text",
          payload: { content: "Implementation " },
        },
        {
          sequenceNum: 3,
          kind: "agent.wave.agent_done",
          payload: { agent: "frontend-developer", taskId: "A-1", success: true },
        },
        {
          sequenceNum: 4,
          kind: "agent.text",
          payload: { content: "completed and pushed" },
        },
        {
          sequenceNum: 5,
          kind: "agent.text.complete",
          payload: {
            fullText: [
              "Implementation finished.",
              "",
              "## Summary",
              "- Completed A-1",
            ].join("\n"),
          },
        },
      ],
    });

    expect(result.ok).toBe(true);
    expect(result.pendingTaskIds).toEqual([]);
    expect(result.observedCompletionSignal).toBe(true);
    expect(result.structuredSummary).toBe("## Summary\n- Completed A-1");
  });

  it("passes when runner-implement closes cleanly via canonical events", () => {
    const result = validateRunnerImplementCompletion({
      rawSummary: "## Summary\n- Completed A-1",
      sessionEvents: [
        {
          sequenceNum: 1,
          kind: "agent.wave.start",
          payload: {
            agents: [{ agent: "frontend-developer", taskId: "A-1", title: "Task one" }],
          },
        },
        {
          sequenceNum: 2,
          kind: "agent.wave.agent_done",
          payload: { agent: "frontend-developer", taskId: "A-1", success: true },
        },
        {
          sequenceNum: 3,
          kind: "job.completed",
          payload: { summary: "## Summary\n- Completed A-1" },
        },
      ],
    });

    expect(result.ok).toBe(true);
    expect(result.pendingTaskIds).toEqual([]);
    expect(result.observedCompletionSignal).toBe(true);
    expect(result.structuredSummary).toBe("## Summary\n- Completed A-1");
  });

  it("accepts canonical session events as the completion source", () => {
    const result = validateRunnerImplementCompletion({
      rawSummary: "## Summary\n- Completed A-1",
      sessionEvents: [
        {
          sequenceNum: 1,
          kind: "agent.wave.start",
          payload: {
            agents: [{ agent: "frontend-developer", taskId: "A-1", title: "Task one" }],
          },
        },
        {
          sequenceNum: 2,
          kind: "agent.wave.agent_done",
          payload: { agent: "frontend-developer", taskId: "A-1", success: true },
        },
        {
          sequenceNum: 3,
          kind: "job.completed",
          payload: { summary: "## Summary\n- Completed A-1" },
        },
      ],
    });

    expect(result.ok).toBe(true);
    expect(result.pendingTaskIds).toEqual([]);
    expect(result.observedCompletionSignal).toBe(true);
    expect(result.structuredSummary).toBe("## Summary\n- Completed A-1");
  });

  it("recovers summary from canonical events when rawSummary lacks ## Summary", () => {
    const result = validateRunnerImplementCompletion({
      rawSummary: "Both agents confirmed completed. All 4 tasks implemented.",
      backgroundAgentTimedOut: true,
      sessionEvents: [
        {
          sequenceNum: 1,
          kind: "agent.text.complete",
          payload: {
            fullText: " All done\n\n## Summary\n\n**Total**: 4 | **Completed**: 4",
          },
        },
        {
          sequenceNum: 2,
          kind: "agent.text.complete",
          payload: {
            fullText: "Both agents confirmed completed. All 4 tasks implemented.",
          },
        },
      ],
    });

    expect(result.ok).toBe(true);
    expect(result.observedCompletionSignal).toBe(true);
    expect(result.structuredSummary).toContain("## Summary");
  });

  it("succeeds with ## Summary only in text chunks (no terminal events)", () => {
    // This tests REC-3: Text chunks are valid sources for INV-2 and INV-3
    const result = validateRunnerImplementCompletion({
      backgroundAgentTimedOut: true,
      sessionEvents: [
        {
          sequenceNum: 1,
          kind: "agent.text",
          payload: { content: "All tasks completed. " },
        },
        {
          sequenceNum: 2,
          kind: "agent.text",
          payload: { content: "\n\n## Summary\n- Task A-1 done\n- Task A-2 done" },
        },
      ],
    });

    expect(result.ok).toBe(true);
    expect(result.observedCompletionSignal).toBe(true);
    expect(result.structuredSummary).toBe("## Summary\n- Task A-1 done\n- Task A-2 done");
  });

  it("fails when pendingTaskIds remain even with job.completed (INV-1 violated)", () => {
    // This tests that partial wave completion fails even if job.completed is present
    const result = validateRunnerImplementCompletion({
      sessionEvents: [
        {
          sequenceNum: 1,
          kind: "agent.wave.start",
          payload: {
            agents: [
              { agent: "frontend-developer", taskId: "A-1", title: "Task one" },
              { agent: "backend-architect", taskId: "A-2", title: "Task two" },
              { agent: "database-architect", taskId: "A-3", title: "Task three" },
            ],
          },
        },
        {
          sequenceNum: 2,
          kind: "agent.wave.agent_done",
          payload: { agent: "frontend-developer", taskId: "A-1", success: true },
        },
        {
          sequenceNum: 3,
          kind: "agent.wave.agent_done",
          payload: { agent: "backend-architect", taskId: "A-2", success: true },
        },
        // Note: A-3 is NOT done
        {
          sequenceNum: 4,
          kind: "job.completed",
          payload: { summary: "## Summary\n- Completed A-1 and A-2" },
        },
      ],
    });

    expect(result.ok).toBe(false);
    expect(result.reason).toContain("pending tasks remained: A-3");
    expect(result.pendingTaskIds).toEqual(["A-3"]);
    // Even though job.completed is present, INV-1 is violated
    expect(result.observedCompletionSignal).toBe(true);
    expect(result.structuredSummary).toContain("## Summary");
  });

  it("succeeds with a structured summary split across accumulated text chunks", () => {
    // This tests accumulation: the summary heading can span multiple agent.text events
    const result = validateRunnerImplementCompletion({
      sessionEvents: [
        {
          sequenceNum: 1,
          kind: "agent.text",
          payload: { content: "Implementation complete.\n\n## Sum" },
        },
        {
          sequenceNum: 2,
          kind: "agent.text",
          payload: { content: "mary" },
        },
        {
          sequenceNum: 3,
          kind: "agent.text",
          payload: { content: "\n- All done" },
        },
      ],
    });

    expect(result.ok).toBe(true);
    expect(result.observedCompletionSignal).toBe(true);
    expect(result.structuredSummary).toBe("## Summary\n- All done");
  });

  // ---------------------------------------------------------------------------
  // Expected vs completed work items (hybrid validation — summary + side effects)
  // ---------------------------------------------------------------------------

  it("marks incomplete when expectedWorkItemIds are not all covered by completedWorkItemIds", () => {
    // Reproduces job 2b24a37d: orchestrator reported 7/8 completed in ## Summary
    // but only called complete_ai_task for 2 of 8 tasks.
    const result = validateRunnerImplementCompletion({
      rawSummary: "## Summary\n- All tasks completed",
      expectedWorkItemIds: ["A-1914", "A-1915", "A-1916", "A-1917", "A-1918", "A-1919", "A-1920", "A-1921"],
      completedWorkItemIds: ["A-1914", "A-1920"],
      sessionEvents: [
        {
          sequenceNum: 1,
          kind: "agent.text.complete",
          payload: { fullText: "\n\n## Summary\n- All tasks completed" },
        },
      ],
    });

    expect(result.ok).toBe(false);
    expect(result.completionState).toBe("incomplete");
    expect(result.reason).toContain("6 expected tasks missing complete_ai_task");
    expect(result.missingWorkItemIds).toEqual([
      "A-1915", "A-1916", "A-1917", "A-1918", "A-1919", "A-1921",
    ]);
    // Summary-based checks still pass — this is the whole point of the hybrid check
    expect(result.observedCompletionSignal).toBe(true);
    expect(result.structuredSummary).toContain("## Summary");
  });

  it("passes when expectedWorkItemIds are fully covered by completedWorkItemIds", () => {
    const result = validateRunnerImplementCompletion({
      rawSummary: "## Summary\n- All 3 tasks completed",
      expectedWorkItemIds: ["A-1", "A-2", "A-3"],
      completedWorkItemIds: ["A-1", "A-2", "A-3"],
      sessionEvents: [
        {
          sequenceNum: 1,
          kind: "agent.text.complete",
          payload: { fullText: "\n\n## Summary\n- All 3 tasks completed" },
        },
      ],
    });

    expect(result.ok).toBe(true);
    expect(result.completionState).toBe("complete");
    expect(result.missingWorkItemIds).toEqual([]);
  });

  it("accepts implicit completion when the turn ended cleanly and deterministic side effects are complete", () => {
    const result = validateRunnerImplementCompletion({
      rawSummary: "## Summary\n- Completed all tasks\n- PR: https://github.com/org/repo/pull/17",
      sessionTurnEndedCleanly: true,
      expectedWorkItemIds: ["wi-1", "wi-2"],
      completedWorkItemIds: ["wi-1", "wi-2"],
      sessionEvents: [
        {
          sequenceNum: 1,
          kind: "agent.wave.start",
          payload: {
            agents: [
              { agent: "backend-architect", taskId: "A-1", title: "Task one" },
              { agent: "frontend-developer", taskId: "A-2", title: "Task two" },
            ],
          },
        },
        {
          sequenceNum: 2,
          kind: "agent.wave.agent_done",
          payload: { agent: "backend-architect", taskId: "A-1", success: true },
        },
        {
          sequenceNum: 3,
          kind: "agent.wave.agent_done",
          payload: { agent: "frontend-developer", taskId: "A-2", success: true },
        },
      ],
    });

    expect(result.ok).toBe(true);
    expect(result.observedCompletionSignal).toBe(true);
    expect(result.sawImplicitCompletionSignal).toBe(true);
    expect(result.pendingTaskIds).toEqual([]);
    expect(result.missingWorkItemIds).toEqual([]);
  });

  it("ignores the hybrid check when expectedWorkItemIds is undefined (backward compat)", () => {
    // Without expectedWorkItemIds, the validator behaves exactly as before.
    const result = validateRunnerImplementCompletion({
      rawSummary: "## Summary\n- Completed A-1",
      sessionEvents: [
        {
          sequenceNum: 1,
          kind: "agent.text.complete",
          payload: { fullText: "\n\n## Summary\n- Completed A-1" },
        },
      ],
    });

    expect(result.ok).toBe(true);
    expect(result.missingWorkItemIds).toEqual([]);
  });

  it("treats a terminal ## Summary as the completion signal after a recoverable push warning", () => {
    const result = validateRunnerImplementCompletion({
      sessionEvents: [
        {
          sequenceNum: 1,
          kind: "agent.wave.start",
          payload: {
            agents: [{ agent: "frontend-developer", taskId: "A-1718", title: "Archive page" }],
          },
        },
        {
          sequenceNum: 2,
          kind: "agent.wave.agent_done",
          payload: { agent: "frontend-developer", taskId: "A-1718", success: true },
        },
        {
          sequenceNum: 3,
          kind: "agent.text.complete",
          payload: {
            fullText: "Push failed\nWave complete: 1/1 success",
          },
        },
        {
          sequenceNum: 4,
          kind: "agent.text.complete",
          payload: {
            fullText: "## Summary\n- Completed A-1718",
          },
        },
      ],
    });

    expect(result.ok).toBe(true);
    expect(result.pendingTaskIds).toEqual([]);
    expect(result.observedCompletionSignal).toBe(true);
    expect(result.structuredSummary).toBe("## Summary\n- Completed A-1718");
  });

  it("accepts canonical agent.summary events emitted by OpenCode as completion", () => {
    const result = validateRunnerImplementCompletion({
      sessionTurnEndedCleanly: true,
      expectedWorkItemIds: ["wi-1", "wi-2"],
      completedWorkItemIds: ["wi-1", "wi-2"],
      sessionEvents: [
        {
          sequenceNum: 1,
          kind: "agent.summary",
          payload: {
            section: "Resumen",
            text: "de reparación DoD — F-E-4\n\n### Tareas reparadas (2/2)\n- F-51\n- F-52",
          },
        },
      ],
    });

    expect(result.ok).toBe(true);
    expect(result.observedCompletionSignal).toBe(true);
    expect(result.sawImplicitCompletionSignal).toBe(false);
    expect(result.structuredSummary).toContain("## Resumen");
    expect(result.structuredSummary).toContain("de reparación DoD — F-E-4");
  });
});

describe("inspectRunnerImplementSessionEvents", () => {
  it("tracks pending task ids and completion from canonical events", () => {
    expect(inspectRunnerImplementSessionEvents([
      {
        sequenceNum: 1,
        kind: "agent.wave.start",
        payload: {
          agents: [
            { agent: "frontend-developer", taskId: "A-1", title: "Task one" },
            { agent: "backend-architect", taskId: "A-2", title: "Task two" },
          ],
        },
      },
      {
        sequenceNum: 2,
        kind: "agent.wave.agent_done",
        payload: { agent: "frontend-developer", taskId: "A-1", success: true },
      },
      {
        sequenceNum: 3,
        kind: "job.completed",
        payload: { summary: "done" },
      },
    ])).toEqual({
      pendingTaskIds: ["A-2"],
      observedCompletionSignal: true,
      observedWaveSignals: true,
      summary: "done",
    });
  });

  it("extracts a structured summary from canonical text events", () => {
    expect(inspectRunnerImplementSessionEvents([
      {
        sequenceNum: 1,
        kind: "agent.wave.start",
        payload: {
          agents: [{ agent: "frontend-developer", taskId: "A-1", title: "Task one" }],
        },
      },
      {
        sequenceNum: 2,
        kind: "agent.text",
        payload: { content: "Implementation " },
      },
      {
        sequenceNum: 3,
        kind: "agent.wave.agent_done",
        payload: { agent: "frontend-developer", taskId: "A-1", success: true },
      },
      {
        sequenceNum: 4,
        kind: "agent.text",
        payload: { content: "completed and pushed" },
      },
      {
        sequenceNum: 5,
        kind: "agent.text.complete",
        payload: {
          fullText: [
            "Implementation finished.",
            "",
            "## Summary",
            "- Completed A-1",
          ].join("\n"),
        },
      },
    ])).toEqual({
      pendingTaskIds: [],
      observedCompletionSignal: true,
      observedWaveSignals: true,
      summary: "## Summary\n- Completed A-1",
    });
  });

  it("extracts a structured summary from canonical agent.summary events", () => {
    expect(inspectRunnerImplementSessionEvents([
      {
        sequenceNum: 1,
        kind: "agent.summary",
        payload: {
          section: "Resumen",
          text: "de reparación DoD — F-E-6\n\n### Verificación\n- `bun run lint` — pasa",
        },
      },
    ])).toEqual({
      pendingTaskIds: [],
      observedCompletionSignal: true,
      observedWaveSignals: false,
      summary: "## Resumen de reparación DoD — F-E-6\n\n### Verificación\n- `bun run lint` — pasa",
    });
  });
});

describe("runner-implement completion event subscriptions", () => {
  it("includes agent.summary so completion evaluation loads canonical summaries", () => {
    expect(RUNNER_IMPLEMENT_COMPLETION_EVENT_KINDS).toContain("agent.summary");
  });
});

describe("strict completion guards", () => {
  it("prevents completion when a strict summary is required but missing", () => {
    expect(
      shouldMarkJobAsCompleted({
        sessionSuccess: true,
        isPrFirstFlow: true,
        pushSucceeded: true,
        requiresStructuredSummary: true,
        hasStructuredSummary: false,
      }),
    ).toBe(false);
  });

  it("prevents completion when a write-capable flow still has not pushed", () => {
    expect(
      shouldMarkJobAsCompleted({
        sessionSuccess: true,
        isPrFirstFlow: false,
        pushSucceeded: false,
        requiresPush: true,
      }),
    ).toBe(false);
  });

  it("prevents completion when changes were pushed but no PR exists", () => {
    expect(
      shouldMarkJobAsCompleted({
        sessionSuccess: true,
        isPrFirstFlow: false,
        pushSucceeded: true,
        requiresPush: true,
        requiresPullRequest: true,
        hasPullRequest: false,
      }),
    ).toBe(false);
  });

  it("prevents PR ready when background work timed out and contract NOT satisfied", () => {
    // INV-1 violated: hasPendingAgentTasks = true
    expect(
      shouldMarkPrReady({
        sessionSuccess: true,
        pushSucceeded: true,
        prNumber: 42,
        repoUrl: "https://github.com/almirant-ai/almirant",
        requiresStructuredSummary: true,
        hasStructuredSummary: true,
        backgroundAgentTimedOut: true,
        hasPendingAgentTasks: true,
        observedCompletionSignal: true,
      }),
    ).toBe(false);
  });

  it("allows PR ready when background work timed out BUT contract IS satisfied (REC-1)", () => {
    // All invariants satisfied: observedCompletionSignal, !hasPendingAgentTasks, hasStructuredSummary
    expect(
      shouldMarkPrReady({
        sessionSuccess: true,
        pushSucceeded: true,
        prNumber: 42,
        repoUrl: "https://github.com/almirant-ai/almirant",
        requiresStructuredSummary: true,
        hasStructuredSummary: true,
        backgroundAgentTimedOut: true,
        hasPendingAgentTasks: false,
        observedCompletionSignal: true,
      }),
    ).toBe(true);
  });
});

describe("REC-1 recovery: background agent timeout with satisfied contract", () => {
  it("recovers completion when background agent times out but contract is satisfied", () => {
    // INV-1: no pending tasks
    // INV-2: observedCompletionSignal = true
    // INV-3: hasStructuredSummary = true
    expect(
      shouldMarkJobAsCompleted({
        sessionSuccess: true,
        isPrFirstFlow: true,
        pushSucceeded: true,
        backgroundAgentTimedOut: true,
        requiresStructuredSummary: true,
        hasStructuredSummary: true,
        hasPendingAgentTasks: false,
        observedCompletionSignal: true,
      }),
    ).toBe(true);
  });

  it("fails when background agent times out and contract is NOT satisfied (INV-1 violated)", () => {
    // INV-1 violated: hasPendingAgentTasks = true
    expect(
      shouldMarkJobAsCompleted({
        sessionSuccess: true,
        isPrFirstFlow: true,
        pushSucceeded: true,
        backgroundAgentTimedOut: true,
        requiresStructuredSummary: true,
        hasStructuredSummary: true,
        hasPendingAgentTasks: true,
        observedCompletionSignal: true,
      }),
    ).toBe(false);
  });

  it("fails when background agent times out and contract is NOT satisfied (INV-2 violated)", () => {
    // INV-2 violated: observedCompletionSignal = false
    expect(
      shouldMarkJobAsCompleted({
        sessionSuccess: true,
        isPrFirstFlow: true,
        pushSucceeded: true,
        backgroundAgentTimedOut: true,
        requiresStructuredSummary: true,
        hasStructuredSummary: true,
        hasPendingAgentTasks: false,
        observedCompletionSignal: false,
      }),
    ).toBe(false);
  });

  it("fails when background agent times out and contract is NOT satisfied (INV-3 violated)", () => {
    // INV-3 violated: requiresStructuredSummary but !hasStructuredSummary
    expect(
      shouldMarkJobAsCompleted({
        sessionSuccess: true,
        isPrFirstFlow: true,
        pushSucceeded: true,
        backgroundAgentTimedOut: true,
        requiresStructuredSummary: true,
        hasStructuredSummary: false,
        hasPendingAgentTasks: false,
        observedCompletionSignal: true,
      }),
    ).toBe(false);
  });

  it("blocks completion when hasMissingWorkItems is true, even if all other invariants pass", () => {
    // INV-4 (new): expected work items must all be covered by complete_ai_task calls.
    expect(
      shouldMarkJobAsCompleted({
        sessionSuccess: true,
        isPrFirstFlow: true,
        pushSucceeded: true,
        requiresStructuredSummary: true,
        hasStructuredSummary: true,
        hasPendingAgentTasks: false,
        observedCompletionSignal: true,
        hasMissingWorkItems: true,
      }),
    ).toBe(false);
  });

  it("blocks PR ready when hasMissingWorkItems is true", () => {
    expect(
      shouldMarkPrReady({
        sessionSuccess: true,
        pushSucceeded: true,
        prNumber: 42,
        repoUrl: "https://github.com/almirant-ai/almirant",
        requiresStructuredSummary: true,
        hasStructuredSummary: true,
        backgroundAgentTimedOut: false,
        hasPendingAgentTasks: false,
        observedCompletionSignal: true,
        hasMissingWorkItems: true,
      }),
    ).toBe(false);
  });

  it("succeeds when background agent times out, no summary required, and INV-1/INV-2 satisfied", () => {
    // INV-3 is satisfied because requiresStructuredSummary = false
    expect(
      shouldMarkJobAsCompleted({
        sessionSuccess: true,
        isPrFirstFlow: true,
        pushSucceeded: true,
        backgroundAgentTimedOut: true,
        requiresStructuredSummary: false,
        hasStructuredSummary: false,
        hasPendingAgentTasks: false,
        observedCompletionSignal: true,
      }),
    ).toBe(true);
  });
});

describe("detectNoSkillProgress", () => {
  it("accepts canonical progress events even when the transcript is plain text", () => {
    expect(
      detectNoSkillProgress("Plain text summary", 5_000, 0, [
        {
          sequenceNum: 1,
          kind: CANONICAL_SKILL_PROGRESS_EVENT_KINDS[0],
          payload: { description: "Working" },
        },
      ]),
    ).toBeNull();
  });

  it("flags missing progress when there are no canonical events", () => {
    expect(detectNoSkillProgress("Plain text summary", 5_000, 0, [])).toEqual({
      reason: "Session completed without canonical progress events — skill may not have been recognized",
      pattern: "no_skill_progress",
    });
  });

  it("flags empty output only when there was no canonical progress", () => {
    expect(detectNoSkillProgress("", 5_000, 0, [])).toEqual({
      reason: "Session completed with no output — skill may not exist or failed to start",
      pattern: "no_skill_output",
    });
  });
});

// ---------------------------------------------------------------------------
// A-1753: Missing Completion Signal Cluster — Fixture-Based Tests
// ---------------------------------------------------------------------------

import { missingCompletionSignalFixtures } from "../../test/fixtures/missing-completion-signal-fixtures";

describe("missing completion signal cluster (A-1753)", () => {
  /**
   * These tests validate the behavior of inspectRunnerImplementSessionEvents
   * and validateRunnerImplementCompletion against real-world fixtures
   * representing the "missing completion signal" bug cluster.
   */

  describe("inspectRunnerImplementSessionEvents with real fixtures", () => {
    it("fixture 1: transcriptHasSummaryButJobFails — detects completion from text events", () => {
      const fixture = missingCompletionSignalFixtures.transcriptHasSummaryButJobFails;
      const result = inspectRunnerImplementSessionEvents(fixture.events);

      // Invariant broken: job.completed was never emitted, but we should still
      // detect ## Summary from the text events
      expect(result.observedCompletionSignal).toBe(fixture.expectedResult.observedCompletionSignal);
      expect(result.pendingTaskIds).toEqual(fixture.expectedResult.pendingTaskIds);
      expect(result.observedCompletionSignal).toBe(fixture.expectedResult.observedCompletionSignal);
      expect(result.observedWaveSignals).toBe(fixture.expectedResult.observedWaveSignals);
      expect(!!result.summary).toBe(fixture.expectedResult.hasSummary);
    });

    it("fixture 2: partialWaveCompletion — detects pending tasks despite job.completed", () => {
      const fixture = missingCompletionSignalFixtures.partialWaveCompletion;
      const result = inspectRunnerImplementSessionEvents(fixture.events);

      // Invariant broken: job.completed was emitted but pendingTaskIds remain
      expect(result.observedCompletionSignal).toBe(fixture.expectedResult.observedCompletionSignal);
      expect(result.pendingTaskIds).toEqual(fixture.expectedResult.pendingTaskIds);
      expect(result.observedCompletionSignal).toBe(fixture.expectedResult.observedCompletionSignal);
      expect(result.observedWaveSignals).toBe(fixture.expectedResult.observedWaveSignals);
      expect(!!result.summary).toBe(fixture.expectedResult.hasSummary);
    });

    it("fixture 3: summaryInTextChunksOnly — extracts summary from text chunks only", () => {
      const fixture = missingCompletionSignalFixtures.summaryInTextChunksOnly;
      const result = inspectRunnerImplementSessionEvents(fixture.events);

      // Invariant broken: no terminal events, but completion signals in text
      expect(result.observedCompletionSignal).toBe(fixture.expectedResult.observedCompletionSignal);
      expect(result.pendingTaskIds).toEqual(fixture.expectedResult.pendingTaskIds);
      expect(result.observedCompletionSignal).toBe(fixture.expectedResult.observedCompletionSignal);
      expect(result.observedWaveSignals).toBe(fixture.expectedResult.observedWaveSignals);
      expect(!!result.summary).toBe(fixture.expectedResult.hasSummary);
    });

    it("fixture 4: summarySplitAcrossChunks — accumulates a split summary across chunks", () => {
      const fixture = missingCompletionSignalFixtures.summarySplitAcrossChunks;
      const result = inspectRunnerImplementSessionEvents(fixture.events);

      // Regression test: accumulator must detect split structured summaries
      expect(result.pendingTaskIds).toEqual(fixture.expectedResult.pendingTaskIds);
      expect(result.observedCompletionSignal).toBe(fixture.expectedResult.observedCompletionSignal);
      expect(result.observedWaveSignals).toBe(fixture.expectedResult.observedWaveSignals);
      expect(!!result.summary).toBe(fixture.expectedResult.hasSummary);
    });

    it("fixture 5: noWaveSignalsTextOnly — baseline behavior for non-wave jobs", () => {
      const fixture = missingCompletionSignalFixtures.noWaveSignalsTextOnly;
      const result = inspectRunnerImplementSessionEvents(fixture.events);

      // Baseline: establishes expected behavior
      expect(result.pendingTaskIds).toEqual(fixture.expectedResult.pendingTaskIds);
      expect(result.observedCompletionSignal).toBe(fixture.expectedResult.observedCompletionSignal);
      expect(result.observedWaveSignals).toBe(fixture.expectedResult.observedWaveSignals);
      expect(!!result.summary).toBe(fixture.expectedResult.hasSummary);
    });
  });

  describe("validateRunnerImplementCompletion with real fixtures", () => {
    it("fixture 1: transcriptHasSummaryButJobFails — should pass (text contains completion signals)", () => {
      const fixture = missingCompletionSignalFixtures.transcriptHasSummaryButJobFails;
      const result = validateRunnerImplementCompletion({
        sessionEvents: fixture.events,
        backgroundAgentTimedOut: true, // Simulating the timeout scenario
      });

      // Current behavior: should pass because ## Summary are in text events
      expect(result.ok).toBe(true);
      expect(result.observedCompletionSignal).toBe(true);
      expect(result.pendingTaskIds).toEqual([]);
      expect(result.structuredSummary).toContain("## Summary");
    });

    it("fixture 2: partialWaveCompletion — should FAIL (INV-1 violated: pending tasks)", () => {
      const fixture = missingCompletionSignalFixtures.partialWaveCompletion;
      const result = validateRunnerImplementCompletion({
        sessionEvents: fixture.events,
      });

      // This is the expected behavior: fail because TASK-103 never completed
      expect(result.ok).toBe(false);
      expect(result.reason).toContain("pending tasks remained: TASK-103");
      expect(result.pendingTaskIds).toEqual(["TASK-103"]);
      // Note: job.completed was emitted, so observedCompletionSignal = true
      expect(result.observedCompletionSignal).toBe(true);
      expect(result.structuredSummary).toContain("## Summary");
    });

    it("fixture 3: summaryInTextChunksOnly — should pass (REC-3: text chunks are valid sources)", () => {
      const fixture = missingCompletionSignalFixtures.summaryInTextChunksOnly;
      const result = validateRunnerImplementCompletion({
        sessionEvents: fixture.events,
        backgroundAgentTimedOut: true, // Simulating early termination
      });

      // Current behavior: should pass because ## Summary are in accumulated text
      expect(result.ok).toBe(true);
      expect(result.observedCompletionSignal).toBe(true);
      expect(result.pendingTaskIds).toEqual([]);
      expect(result.structuredSummary).toContain("## Summary");
    });

    it("fixture 4: summarySplitAcrossChunks — should pass (regression test for accumulator)", () => {
      const fixture = missingCompletionSignalFixtures.summarySplitAcrossChunks;
      const result = validateRunnerImplementCompletion({
        sessionEvents: fixture.events,
      });

      // This tests that the accumulator correctly detects a structured summary split across chunks
      expect(result.ok).toBe(true);
      expect(result.observedCompletionSignal).toBe(true);
      expect(result.pendingTaskIds).toEqual([]);
      expect(result.structuredSummary).toContain("## Summary");
    });

    it("fixture 5: noWaveSignalsTextOnly — should pass (baseline non-wave behavior)", () => {
      const fixture = missingCompletionSignalFixtures.noWaveSignalsTextOnly;
      const result = validateRunnerImplementCompletion({
        sessionEvents: fixture.events,
      });

      // Baseline: single-agent jobs without waves should work
      expect(result.ok).toBe(true);
      expect(result.observedCompletionSignal).toBe(true);
      expect(result.pendingTaskIds).toEqual([]);
      expect(result.structuredSummary).toContain("## Summary");
    });
  });

  describe("shouldMarkJobAsCompleted with fixture-derived inputs", () => {
    it("fixture 1: transcriptHasSummaryButJobFails — allows completion when contract is satisfied via text events", () => {
      // Even though job.completed was never emitted, the text events satisfy the contract
      expect(
        shouldMarkJobAsCompleted({
          sessionSuccess: true,
          isPrFirstFlow: true,
          pushSucceeded: true,
          backgroundAgentTimedOut: true, // The job timed out
          requiresStructuredSummary: true,
          hasStructuredSummary: true, // Detected from text events
          hasPendingAgentTasks: false, // All wave tasks completed
          observedCompletionSignal: true, // Detected from text events
        }),
      ).toBe(true);
    });

    it("fixture 2: partialWaveCompletion — blocks completion due to pending tasks (INV-1)", () => {
      // Contract violation: pending tasks remain
      expect(
        shouldMarkJobAsCompleted({
          sessionSuccess: true,
          isPrFirstFlow: true,
          pushSucceeded: true,
          backgroundAgentTimedOut: false,
          requiresStructuredSummary: true,
          hasStructuredSummary: true,
          hasPendingAgentTasks: true, // TASK-103 never completed
          observedCompletionSignal: true,
        }),
      ).toBe(false);
    });

    it("fixture 3: summaryInTextChunksOnly — allows completion when text chunks provide signals", () => {
      // Text chunks are valid sources for completion signals (REC-3)
      expect(
        shouldMarkJobAsCompleted({
          sessionSuccess: true,
          isPrFirstFlow: true,
          pushSucceeded: true,
          backgroundAgentTimedOut: true,
          requiresStructuredSummary: true,
          hasStructuredSummary: true, // Detected from accumulated text
          hasPendingAgentTasks: false,
          observedCompletionSignal: true, // Detected from accumulated text
        }),
      ).toBe(true);
    });
  });

  describe("shouldMarkPrReady with fixture-derived inputs", () => {
    it("fixture 1: transcriptHasSummaryButJobFails — allows PR ready when contract satisfied via text", () => {
      expect(
        shouldMarkPrReady({
          sessionSuccess: true,
          pushSucceeded: true,
          prNumber: 42,
          repoUrl: "https://github.com/example/repo",
          backgroundAgentTimedOut: true,
          requiresStructuredSummary: true,
          hasStructuredSummary: true,
          hasPendingAgentTasks: false,
          observedCompletionSignal: true,
        }),
      ).toBe(true);
    });

    it("fixture 2: partialWaveCompletion — blocks PR ready due to pending tasks", () => {
      expect(
        shouldMarkPrReady({
          sessionSuccess: true,
          pushSucceeded: true,
          prNumber: 42,
          repoUrl: "https://github.com/example/repo",
          backgroundAgentTimedOut: false,
          requiresStructuredSummary: true,
          hasStructuredSummary: true,
          hasPendingAgentTasks: true, // TASK-103 pending
          observedCompletionSignal: true,
        }),
      ).toBe(false);
    });
  });

  // ---------------------------------------------------------------------------
  // RED Tests: Known failing scenarios that need fixes in A-1755
  // ---------------------------------------------------------------------------

  describe.skip("RED: Known issues requiring fixes (A-1755)", () => {
    // These tests document known issues that the current implementation does NOT handle.
    // They are marked as .skip because they would fail until A-1755 is implemented.
    // When working on A-1755, remove .skip and make these tests pass.

    it("RED: should detect partial completion when some agent_done events are missing", () => {
      // Current behavior: The system correctly detects pendingTaskIds, but
      // the job.completed event is still emitted by the orchestrator in some
      // edge cases. This test documents the expectation that the orchestrator
      // should NOT emit job.completed when pendingTaskIds remain.
      //
      // Fix in A-1755: Add a pre-emit check to the orchestrator that blocks
      // job.completed if pendingTaskIds.length > 0.

      const fixture = missingCompletionSignalFixtures.partialWaveCompletion;
      const inspection = inspectRunnerImplementSessionEvents(fixture.events);

      // This assertion documents the current (incorrect) behavior:
      // job.completed was emitted even though TASK-103 is pending
      expect(inspection.observedCompletionSignal).toBe(true);
      expect(inspection.pendingTaskIds.length).toBeGreaterThan(0);

      // TODO: In A-1755, add logic so that the orchestrator does NOT emit
      // job.completed when there are pending tasks. The test above documents
      // the problem; the fix should prevent this inconsistency from occurring.
    });

    it("RED: should recover gracefully when session ends without terminal events", () => {
      // Current behavior: The system can detect ## Summary from
      // accumulated text chunks, which is correct. However, if the session
      // crashes between the last text chunk and the terminal events, the
      // system does not persist an intermediate recovery checkpoint.
      //
      // Fix in A-1755: Add a recovery checkpoint mechanism that saves the
      // accumulated state after detecting ## Summary, so that
      // a follow-up recovery job can finalize completion without re-running.

      const fixture = missingCompletionSignalFixtures.summaryInTextChunksOnly;
      const result = validateRunnerImplementCompletion({
        sessionEvents: fixture.events,
        backgroundAgentTimedOut: true,
      });

      // This passes currently — the real issue is that we don't persist
      // the recovery state, so if the runner crashes after this validation
      // but before updating job status, the job will be re-run from scratch.
      expect(result.ok).toBe(true);

      // TODO: In A-1755, add a checkpoint mechanism. This test should then
      // verify that calling a hypothetical `persistRecoveryCheckpoint()`
      // function stores the completion state durably.
    });

    it("RED: should handle race condition between timeout and completion", () => {
      // Current behavior: The background agent timeout fires independently
      // of the completion signal detection. If the timeout fires 1ms before
      // the job.completed event arrives, the job is marked as failed even
      // though completion was imminent.
      //
      // Fix in A-1755: Add a grace period after timeout fires to check for
      // in-flight completion signals, OR change the timeout to be cancellable
      // when completion signals are observed.

      const fixture = missingCompletionSignalFixtures.transcriptHasSummaryButJobFails;

      // Document the expected flow:
      // 1. Timeout fires at T=10:05:18.000Z
      // 2. agent.text.complete arrives at T=10:05:20.000Z (2s later)
      // 3. job.completed would have arrived at ~T=10:05:22.000Z
      //
      // Current behavior: Job is marked failed at step 1
      // Expected behavior: Grace period allows steps 2-3 to complete

      // This test is a placeholder — actual implementation in A-1755 will
      // add a grace period or cancellable timeout mechanism.
      expect(fixture.events.some((e: { kind: string }) => e.kind === "job.completed")).toBe(false);
      expect(fixture.invariantBroken).toContain("job timed out before job.completed");
    });
  });
});

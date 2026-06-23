import { describe, expect, it } from "bun:test";
import type {
  AlmirantWorkerClient,
  ClaimedJob,
  SessionEventRecord,
  WorkItemDetails,
} from "@almirant/remote-agent";
import type { RunnerJobEventLogger } from "../observability/job-event-logger";
import type { ContainerManager } from "../workspace/container-manager";
import { evaluateCompletion, type SessionResult } from "./completion-evaluator";

const createWorkerClient = (
  sessionEvents: SessionEventRecord[] = [],
  snapshotOverride?: {
    expectedWorkItemIds?: string[];
    completedWorkItemIds?: string[];
  },
  transcript = "",
  workItemOverride?: WorkItemDetails,
): AlmirantWorkerClient =>
  ({
    getJobSessionEvents: async () => sessionEvents,
    getJobTranscript: async () => ({ transcript }),
    getWorkItem: async () =>
      workItemOverride ??
      ({
        id: "wi-1",
        metadata: {},
      } as WorkItemDetails),
    resetStaleChildTasks: async () => ({ resetIds: [] }),
    getJobCompletionSnapshot: async (jobId: string) => ({
      jobId,
      rootWorkItemId: null,
      expectedWorkItemIds: snapshotOverride?.expectedWorkItemIds ?? [],
      completedWorkItemIds: snapshotOverride?.completedWorkItemIds ?? [],
    }),
  }) as unknown as AlmirantWorkerClient;

const createEventLogger = (): RunnerJobEventLogger =>
  ({
    info: () => undefined,
    warn: () => undefined,
    error: () => undefined,
  }) as unknown as RunnerJobEventLogger;

const createJob = (overrides: Partial<ClaimedJob> = {}): ClaimedJob =>
  ({
    id: "job-1",
    prompt: null,
    promptTemplate: null,
    skillName: null,
    retryCount: 0,
    config: {},
    ...overrides,
  }) as ClaimedJob;

const createResult = (overrides: Partial<SessionResult> = {}): SessionResult => ({
  success: true,
  summary: "Plain text summary",
  ...overrides,
});

const createWorkItem = (
  metadata: Record<string, unknown> = {},
): WorkItemDetails =>
  ({
    id: "wi-1",
    taskId: "F-E-23",
    title: "Definition of Done review target",
    description: null,
    boardId: "board-1",
    boardColumnId: "review",
    projectId: "project-1",
    parentId: null,
    type: "task",
    priority: "medium",
    metadata,
    estimatedHours: null,
  }) as WorkItemDetails;

describe("evaluateCompletion", () => {
  it("skips no-skill-progress detection for prompt-only jobs even if telemetry uses a different label", async () => {
    const completion = await evaluateCompletion(
      {
        workerClient: createWorkerClient([]),
        containerManager: {} as ContainerManager,
      },
      {
        job: createJob({
          prompt: "Resuelve un ticket de feedback bug",
          promptTemplate: null,
          skillName: null,
        }),
        result: createResult(),
        skillName: "scheduled",
        pushSucceeded: false,
        requiresPush: false,
        prFirstResult: null,
        eventLogger: createEventLogger(),
        startedAtMs: Date.now() - 5_000,
        containerId: null,
        extractedBranchName: null,
        baseBranch: "main",
        workerId: "worker-1",
      },
    );

    expect(completion.result.success).toBe(true);
    expect(completion.result.errorMessage).toBeUndefined();
    expect(completion.jobCompleted).toBe(true);
  });

  it("marks runner-implement incomplete when some expected tasks lack complete_ai_task (INV-4)", async () => {
    // Reproduces job 2b24a37d: orchestrator emitted ## Summary + 
    // but only 2 of 8 tasks received a complete_ai_task call.
    const sessionEvents: SessionEventRecord[] = [
      {
        sequenceNum: 1,
        kind: "agent.text.complete",
        payload: {
          fullText: " All done\n\n## Summary\n- 8 tasks completed",
        },
      },
    ];

    const completion = await evaluateCompletion(
      {
        workerClient: createWorkerClient(sessionEvents, {
          expectedWorkItemIds: ["wi-1", "wi-2", "wi-3", "wi-4"],
          completedWorkItemIds: ["wi-1", "wi-2"],
        }),
        containerManager: {} as ContainerManager,
      },
      {
        job: createJob({
          prompt: null,
          promptTemplate: "runner-implement",
          skillName: "runner-implement",
        }),
        result: createResult({ summary: "## Summary\n- 8 tasks completed" }),
        skillName: "runner-implement",
        pushSucceeded: true,
        requiresPush: false,
        prFirstResult: null,
        eventLogger: createEventLogger(),
        startedAtMs: Date.now() - 120_000,
        containerId: null,
        extractedBranchName: null,
        baseBranch: "main",
        workerId: "worker-1",
      },
    );

    expect(completion.jobCompleted).toBe(false);
    expect(completion.jobStatus).toBe("incomplete");
    expect(completion.result.success).toBe(true);
    expect(completion.result.errorMessage).toBeUndefined();
    expect(completion.result.incompleteReason).toContain(
      "expected tasks missing complete_ai_task",
    );
    expect(completion.result.incompleteReason).toContain("wi-3");
    expect(completion.result.incompleteReason).toContain("wi-4");
    expect(completion.result.missingWorkItemIds).toEqual(["wi-3", "wi-4"]);
  });

  it("applies the same complete_ai_task contract to runner-fix-dod remediation jobs", async () => {
    const sessionEvents: SessionEventRecord[] = [
      {
        sequenceNum: 1,
        kind: "agent.text.complete",
        payload: {
          fullText: "DoD fixed\n\n## Summary\n- 2 tasks fixed",
        },
      },
    ];

    const completion = await evaluateCompletion(
      {
        workerClient: createWorkerClient(sessionEvents, {
          expectedWorkItemIds: ["wi-1", "wi-2"],
          completedWorkItemIds: ["wi-1"],
        }),
        containerManager: {} as ContainerManager,
      },
      {
        job: createJob({
          prompt: null,
          promptTemplate: "runner-fix-dod",
          skillName: "runner-fix-dod",
        }),
        result: createResult({ summary: "## Summary\n- 2 tasks fixed" }),
        skillName: "runner-fix-dod",
        pushSucceeded: true,
        requiresPush: false,
        prFirstResult: null,
        eventLogger: createEventLogger(),
        startedAtMs: Date.now() - 120_000,
        containerId: null,
        extractedBranchName: null,
        baseBranch: "main",
        workerId: "worker-1",
      },
    );

    expect(completion.jobCompleted).toBe(false);
    expect(completion.jobStatus).toBe("incomplete");
    expect(completion.result.missingWorkItemIds).toEqual(["wi-2"]);
  });

  it("marks runner-implement complete when every expected task has complete_ai_task (INV-4)", async () => {
    const sessionEvents: SessionEventRecord[] = [
      {
        sequenceNum: 1,
        kind: "agent.text.complete",
        payload: {
          fullText: " All done\n\n## Summary\n- 3 tasks completed",
        },
      },
    ];

    const completion = await evaluateCompletion(
      {
        workerClient: createWorkerClient(sessionEvents, {
          expectedWorkItemIds: ["wi-1", "wi-2", "wi-3"],
          completedWorkItemIds: ["wi-1", "wi-2", "wi-3"],
        }),
        containerManager: {} as ContainerManager,
      },
      {
        job: createJob({
          prompt: null,
          promptTemplate: "runner-implement",
          skillName: "runner-implement",
        }),
        result: createResult({ summary: "## Summary\n- 3 tasks completed" }),
        skillName: "runner-implement",
        pushSucceeded: true,
        requiresPush: false,
        prFirstResult: null,
        eventLogger: createEventLogger(),
        // >90s so detectNoSkillProgress doesn't fire (it requires <90s duration
        // with no canonical progress events — not relevant to the INV-4 check).
        startedAtMs: Date.now() - 120_000,
        containerId: null,
        extractedBranchName: null,
        baseBranch: "main",
        workerId: "worker-1",
      },
    );

    expect(completion.result.success).toBe(true);
    expect(completion.jobCompleted).toBe(true);
    expect(completion.result.errorMessage).toBeUndefined();
  });

  it("recovers opencode runner-implement completion from transcript-only structured summary", async () => {
    const completion = await evaluateCompletion(
      {
        workerClient: createWorkerClient(
          [],
          {
            expectedWorkItemIds: ["wi-1", "wi-2"],
            completedWorkItemIds: ["wi-1", "wi-2"],
          },
          [
            "Session completed",
            "Pushed 2 commits successfully",
            "",
            "## Summary",
            "- Implemented both tasks",
          ].join("\n"),
        ),
        containerManager: {} as ContainerManager,
      },
      {
        job: createJob({
          prompt: null,
          promptTemplate: "runner-implement",
          skillName: "runner-implement",
          codingAgent: "opencode",
        }),
        result: createResult({ summary: "completed" }),
        skillName: "runner-implement",
        pushSucceeded: true,
        requiresPush: true,
        prFirstResult: {
          branchName: "almirant/TEST-1",
          baseBranch: "main",
          prUrl: "https://github.com/example/repo/pull/1",
          prNumber: 1,
          prCreatedByThisJob: true,
        },
        eventLogger: createEventLogger(),
        startedAtMs: Date.now() - 120_000,
        containerId: null,
        extractedBranchName: "almirant/TEST-1",
        baseBranch: "main",
        workerId: "worker-1",
        injectedEnvRepoUrl: "https://github.com/example/repo",
      },
    );

    expect(completion.result.success).toBe(true);
    expect(completion.jobCompleted).toBe(true);
    expect(completion.prSummary).toContain("## Summary");
  });

  it("uses the transcript tail and creates a late PR when the previous PR was completed", async () => {
    const originalFetch = globalThis.fetch;
    const requests: Array<{ url: string; body: string }> = [];
    let transcriptRequestedTail = false;

    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      requests.push({
        url: String(input),
        body: String(init?.body ?? ""),
      });
      return new Response(
        JSON.stringify({
          success: true,
          data: {
            prUrl: "https://github.com/example/repo/pull/123",
            prNumber: 123,
          },
        }),
        {
          status: 200,
          headers: { "content-type": "application/json" },
        },
      );
    }) as typeof fetch;

    try {
      const workerClient = {
        ...createWorkerClient(
          [],
          {
            expectedWorkItemIds: ["wi-1"],
            completedWorkItemIds: ["wi-1"],
          },
          "",
        ),
        getJobTranscript: async (_jobId: string, params?: { tail?: boolean }) => {
          transcriptRequestedTail = params?.tail === true;
          return {
            transcript: params?.tail
              ? "Riesgos pendientes\n\n## Resumen de reparación DoD\n- Todas las tareas reparadas"
              : "first page without a final summary",
          };
        },
      } as unknown as AlmirantWorkerClient;

      const completion = await evaluateCompletion(
        {
          workerClient,
          containerManager: {} as ContainerManager,
        },
        {
          job: createJob({
            promptTemplate: "runner-fix-dod",
            skillName: "runner-fix-dod",
            codingAgent: "opencode",
          }),
          result: createResult({ summary: "completed" }),
          skillName: "runner-fix-dod",
          pushSucceeded: true,
          requiresPush: true,
          prFirstResult: {
            branchName: "almirant/ZC-E-11",
            baseBranch: "main",
            prCreatedByThisJob: false,
          },
          eventLogger: createEventLogger(),
          startedAtMs: Date.now() - 120_000,
          containerId: null,
          extractedBranchName: "almirant/ZC-E-11",
          baseBranch: "main",
          workerId: "worker-1",
          injectedEnvRepoUrl: "https://github.com/example/repo",
          apiBaseUrl: "https://api.example.com",
          apiKey: "worker-key",
        },
      );

      expect(transcriptRequestedTail).toBe(true);
      const createPrRequest = requests.find((request) =>
        request.url === "https://api.example.com/api/github/pull-requests"
      );
      expect(createPrRequest).toBeDefined();
      expect(createPrRequest?.body).toContain("\"head\":\"almirant/ZC-E-11\"");
      expect(createPrRequest?.body).toContain("\"isDraft\":false");
      expect(completion.result.success).toBe(true);
      expect(completion.jobCompleted).toBe(true);
      expect(completion.prResult?.prNumber).toBe(123);
      expect(completion.prResult?.prUrl).toBe("https://github.com/example/repo/pull/123");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("does not use transcript fallback for non-opencode runner-implement jobs", async () => {
    let transcriptCalls = 0;
    const workerClient = {
      ...createWorkerClient(
        [],
        {
          expectedWorkItemIds: ["wi-1"],
          completedWorkItemIds: ["wi-1"],
        },
        "## Summary\n- This should not be used by strict-default policy",
      ),
      getJobTranscript: async () => {
        transcriptCalls += 1;
        return {
          transcript: "## Summary\n- This should not be used by strict-default policy",
        };
      },
    } as unknown as AlmirantWorkerClient;

    const completion = await evaluateCompletion(
      {
        workerClient,
        containerManager: {} as ContainerManager,
      },
      {
        job: createJob({
          prompt: null,
          promptTemplate: "runner-implement",
          skillName: "runner-implement",
          codingAgent: "claude-code",
        }),
        result: createResult({ summary: "completed" }),
        skillName: "runner-implement",
        pushSucceeded: true,
        requiresPush: true,
        prFirstResult: {
          branchName: "almirant/TEST-2",
          baseBranch: "main",
          prUrl: "https://github.com/example/repo/pull/2",
          prNumber: 2,
          prCreatedByThisJob: true,
        },
        eventLogger: createEventLogger(),
        startedAtMs: Date.now() - 120_000,
        containerId: null,
        extractedBranchName: "almirant/TEST-2",
        baseBranch: "main",
        workerId: "worker-1",
        injectedEnvRepoUrl: "https://github.com/example/repo",
      },
    );

    expect(transcriptCalls).toBe(0);
    expect(completion.result.success).toBe(false);
    expect(completion.result.errorMessage).toContain("missing completion signal");
    expect(completion.result.errorMessage).toContain("missing ## Summary block");
    expect(completion.jobCompleted).toBe(false);
  });

  it("keeps opencode runner-implement incomplete when transcript summary exists but complete_ai_task is missing", async () => {
    const completion = await evaluateCompletion(
      {
        workerClient: createWorkerClient(
          [],
          {
            expectedWorkItemIds: ["wi-1", "wi-2"],
            completedWorkItemIds: ["wi-1"],
          },
          "## Summary\n- Claimed both tasks are complete",
        ),
        containerManager: {} as ContainerManager,
      },
      {
        job: createJob({
          prompt: null,
          promptTemplate: "runner-implement",
          skillName: "runner-implement",
          codingAgent: "opencode",
        }),
        result: createResult({ summary: "completed" }),
        skillName: "runner-implement",
        pushSucceeded: true,
        requiresPush: false,
        prFirstResult: null,
        eventLogger: createEventLogger(),
        startedAtMs: Date.now() - 120_000,
        containerId: null,
        extractedBranchName: null,
        baseBranch: "main",
        workerId: "worker-1",
      },
    );

    expect(completion.jobCompleted).toBe(false);
    expect(completion.jobStatus).toBe("incomplete");
    expect(completion.result.success).toBe(true);
    expect(completion.result.incompleteReason).toContain(
      "expected tasks missing complete_ai_task",
    );
    expect(completion.result.missingWorkItemIds).toEqual(["wi-2"]);
  });

  it("still fails skill-driven jobs that complete without canonical progress", async () => {
    const completion = await evaluateCompletion(
      {
        workerClient: createWorkerClient([]),
        containerManager: {} as ContainerManager,
      },
      {
        job: createJob({
          prompt: null,
          promptTemplate: "feedback-bug",
          skillName: "feedback-bug",
        }),
        result: createResult(),
        skillName: "feedback-bug",
        pushSucceeded: false,
        requiresPush: false,
        prFirstResult: null,
        eventLogger: createEventLogger(),
        startedAtMs: Date.now() - 5_000,
        containerId: null,
        extractedBranchName: null,
        baseBranch: "main",
        workerId: "worker-1",
      },
    );

    expect(completion.result.success).toBe(false);
    expect(completion.result.errorMessage).toBe(
      "Session completed without canonical progress events — skill may not have been recognized",
    );
    expect(completion.jobCompleted).toBe(false);
  });

  it("fails dod-review jobs that finish without persisting a DoD result", async () => {
    const workItem = createWorkItem({
      definitionOfDone: ["Criterion"],
    });

    const completion = await evaluateCompletion(
      {
        workerClient: createWorkerClient(
          [],
          undefined,
          "",
          createWorkItem({
            definitionOfDone: ["Criterion"],
          }),
        ),
        containerManager: {} as ContainerManager,
      },
      {
        job: createJob({
          promptTemplate: "dod-review",
          skillName: "dod-review",
          config: {
            source: "dod-review",
          },
        }),
        result: createResult({
          summary: "Review finished but no MCP completion tool was called.",
        }),
        skillName: "dod-review",
        pushSucceeded: false,
        requiresPush: false,
        prFirstResult: null,
        eventLogger: createEventLogger(),
        startedAtMs: Date.now() - 120_000,
        containerId: null,
        extractedBranchName: null,
        baseBranch: "main",
        workItem,
        workerId: "worker-1",
      },
    );

    expect(completion.result.success).toBe(false);
    expect(completion.result.errorMessage).toBe(
      "DoD review session finished without persisting exactly one DoD result via complete_definition_of_done_review",
    );
    expect(completion.jobCompleted).toBe(false);
    expect(completion.jobStatus).toBe("failed");
  });

  it("allows dod-review jobs that persisted either approved or incompleted DoD state", async () => {
    const completion = await evaluateCompletion(
      {
        workerClient: createWorkerClient(
          [],
          undefined,
          "",
          createWorkItem({
            dod_approved: false,
            dod_incompleted: true,
            dod_reviewed_at: "2026-05-02T15:00:00.000Z",
          }),
        ),
        containerManager: {} as ContainerManager,
      },
      {
        job: createJob({
          promptTemplate: "dod-review",
          skillName: "dod-review",
          config: {
            source: "dod-review",
          },
        }),
        result: createResult({
          summary: "DoD incompleted and reported.",
        }),
        skillName: "dod-review",
        pushSucceeded: false,
        requiresPush: false,
        prFirstResult: null,
        eventLogger: createEventLogger(),
        startedAtMs: Date.now() - 120_000,
        containerId: null,
        extractedBranchName: null,
        baseBranch: "main",
        workItem: createWorkItem({
          definitionOfDone: ["Criterion"],
        }),
        workerId: "worker-1",
      },
    );

    expect(completion.result.success).toBe(true);
    expect(completion.jobCompleted).toBe(true);
    expect(completion.jobStatus).toBe("completed");
  });
});

// ---------------------------------------------------------------------------
// A-1753: Missing Completion Signal Cluster — Integration Tests
// ---------------------------------------------------------------------------

import { missingCompletionSignalFixtures } from "../../test/fixtures/missing-completion-signal-fixtures";

describe("evaluateCompletion with missing-completion-signal fixtures (A-1753)", () => {
  /**
   * These tests verify that evaluateCompletion correctly handles the
   * "missing completion signal" edge cases using real-world fixtures.
   */

  it("fixture 1: transcriptHasSummaryButJobFails — recovers completion from text events", async () => {
    const fixture = missingCompletionSignalFixtures.transcriptHasSummaryButJobFails;
    const completion = await evaluateCompletion(
      {
        workerClient: createWorkerClient(fixture.events),
        containerManager: {} as ContainerManager,
      },
      {
        job: createJob({
          skillName: "runner-implement",
        }),
        result: createResult({
          success: true,
          summary: "All tasks completed", // No ## Summary in raw summary
          backgroundAgentTimedOut: true, // The timeout scenario
        }),
        skillName: "runner-implement",
        pushSucceeded: true,
        requiresPush: true,
        prFirstResult: {
          branchName: "feature/test",
          baseBranch: "main",
          prUrl: "https://github.com/example/repo/pull/42",
          prNumber: 42,
          prCreatedByThisJob: true,
        },
        eventLogger: createEventLogger(),
        startedAtMs: Date.now() - 300_000,
        containerId: null,
        extractedBranchName: "feature/test",
        baseBranch: "main",
        workerId: "worker-1",
        injectedEnvRepoUrl: "https://github.com/example/repo",
      },
    );

    // Should recover completion because ## Summary are in text events
    expect(completion.result.success).toBe(true);
    expect(completion.jobCompleted).toBe(true);
    expect(completion.prSummary).toContain("## Summary");
  });

  it("fixture 2: partialWaveCompletion — fails due to pending tasks (INV-1)", async () => {
    const fixture = missingCompletionSignalFixtures.partialWaveCompletion;
    const completion = await evaluateCompletion(
      {
        workerClient: createWorkerClient(fixture.events),
        containerManager: {} as ContainerManager,
      },
      {
        job: createJob({
          skillName: "runner-implement",
        }),
        result: createResult({
          success: true,
          summary: "## Summary\n- Partial completion",
        }),
        skillName: "runner-implement",
        pushSucceeded: true,
        requiresPush: true,
        prFirstResult: {
          branchName: "feature/partial",
          baseBranch: "main",
          prUrl: "https://github.com/example/repo/pull/43",
          prNumber: 43,
          prCreatedByThisJob: true,
        },
        eventLogger: createEventLogger(),
        startedAtMs: Date.now() - 300_000,
        containerId: null,
        extractedBranchName: "feature/partial",
        baseBranch: "main",
        workerId: "worker-1",
        injectedEnvRepoUrl: "https://github.com/example/repo",
      },
    );

    // Should fail because TASK-103 never completed (INV-1 violated)
    expect(completion.result.success).toBe(false);
    expect(completion.result.errorMessage).toContain("pending tasks remained: TASK-103");
    expect(completion.jobCompleted).toBe(false);
  });

  it("fixture 3: summaryInTextChunksOnly — recovers from text-only completion", async () => {
    const fixture = missingCompletionSignalFixtures.summaryInTextChunksOnly;
    const completion = await evaluateCompletion(
      {
        workerClient: createWorkerClient(fixture.events),
        containerManager: {} as ContainerManager,
      },
      {
        job: createJob({
          skillName: "runner-implement",
        }),
        result: createResult({
          success: true,
          summary: "Task completed", // Raw summary without a structured summary
          backgroundAgentTimedOut: true,
        }),
        skillName: "runner-implement",
        pushSucceeded: true,
        requiresPush: true,
        prFirstResult: {
          branchName: "feature/text-only",
          baseBranch: "main",
          prUrl: "https://github.com/example/repo/pull/44",
          prNumber: 44,
          prCreatedByThisJob: true,
        },
        eventLogger: createEventLogger(),
        startedAtMs: Date.now() - 300_000,
        containerId: null,
        extractedBranchName: "feature/text-only",
        baseBranch: "main",
        workerId: "worker-1",
        injectedEnvRepoUrl: "https://github.com/example/repo",
      },
    );

    // Should recover because ## Summary are in accumulated text chunks
    expect(completion.result.success).toBe(true);
    expect(completion.jobCompleted).toBe(true);
  });

  it("fixture 4: summarySplitAcrossChunks — handles a split structured summary", async () => {
    const fixture = missingCompletionSignalFixtures.summarySplitAcrossChunks;
    const completion = await evaluateCompletion(
      {
        workerClient: createWorkerClient(fixture.events),
        containerManager: {} as ContainerManager,
      },
      {
        job: createJob({
          skillName: "runner-implement",
        }),
        result: createResult({
          success: true,
          summary: "## Summary\n- Bundle optimized",
        }),
        skillName: "runner-implement",
        pushSucceeded: true,
        requiresPush: true,
        prFirstResult: {
          branchName: "feature/split-summary",
          baseBranch: "main",
          prUrl: "https://github.com/example/repo/pull/45",
          prNumber: 45,
          prCreatedByThisJob: true,
        },
        eventLogger: createEventLogger(),
        startedAtMs: Date.now() - 300_000,
        containerId: null,
        extractedBranchName: "feature/split-summary",
        baseBranch: "main",
        workerId: "worker-1",
        injectedEnvRepoUrl: "https://github.com/example/repo",
      },
    );

    // Should succeed — the split structured summary must be detected
    expect(completion.result.success).toBe(true);
    expect(completion.jobCompleted).toBe(true);
  });

  it("fixture 5: noWaveSignalsTextOnly — handles non-wave jobs correctly", async () => {
    const fixture = missingCompletionSignalFixtures.noWaveSignalsTextOnly;
    const completion = await evaluateCompletion(
      {
        workerClient: createWorkerClient(fixture.events),
        containerManager: {} as ContainerManager,
      },
      {
        job: createJob({
          skillName: "runner-implement",
        }),
        result: createResult({
          success: true,
          summary: "## Summary\n- Direct completion",
        }),
        skillName: "runner-implement",
        pushSucceeded: true,
        requiresPush: true,
        prFirstResult: {
          branchName: "feature/no-wave",
          baseBranch: "main",
          prUrl: "https://github.com/example/repo/pull/46",
          prNumber: 46,
          prCreatedByThisJob: true,
        },
        eventLogger: createEventLogger(),
        startedAtMs: Date.now() - 300_000,
        containerId: null,
        extractedBranchName: "feature/no-wave",
        baseBranch: "main",
        workerId: "worker-1",
        injectedEnvRepoUrl: "https://github.com/example/repo",
      },
    );

    // Baseline: non-wave jobs should complete normally
    expect(completion.result.success).toBe(true);
    expect(completion.jobCompleted).toBe(true);
  });

  it("recovers when runner-implement ends with a terminal summary after a recoverable push warning", async () => {
    const completion = await evaluateCompletion(
      {
        workerClient: createWorkerClient([
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
            payload: { fullText: "Push failed\nWave complete: 1/1 success" },
          },
          {
            sequenceNum: 4,
            kind: "agent.text.complete",
            payload: { fullText: "## Summary\n- Completed A-1718" },
          },
        ]),
        containerManager: {} as ContainerManager,
      },
      {
        job: createJob({
          skillName: "runner-implement",
        }),
        result: createResult({
          success: true,
          summary: "## Summary\n- Completed A-1718",
        }),
        skillName: "runner-implement",
        pushSucceeded: true,
        requiresPush: true,
        prFirstResult: {
          branchName: "almirant/A-1718",
          baseBranch: "main",
          prUrl: "https://github.com/example/repo/pull/926",
          prNumber: 926,
          prCreatedByThisJob: true,
        },
        eventLogger: createEventLogger(),
        startedAtMs: Date.now() - 300_000,
        containerId: null,
        extractedBranchName: "almirant/A-1718",
        baseBranch: "main",
        workerId: "worker-1",
        injectedEnvRepoUrl: "https://github.com/example/repo",
      },
    );

    expect(completion.result.success).toBe(true);
    expect(completion.jobCompleted).toBe(true);
    expect(completion.prSummary).toBe("## Summary\n- Completed A-1718");
  });
});

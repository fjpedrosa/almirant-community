import { afterEach, describe, expect, it } from "bun:test";
import { evaluateCompletion } from "../src/orchestration/completion-evaluator";

const originalFetch = globalThis.fetch;

const buildWorkerClient = () =>
  ({
    getJobSessionEvents: async () => [
      {
        sequenceNum: 1,
        kind: "agent.step",
        payload: { description: "Working" },
      },
    ],
    resetStaleChildTasks: async () => ({ resetIds: [] }),
    getJobCompletionSnapshot: async (jobId: string) => ({
      jobId,
      rootWorkItemId: null,
      expectedWorkItemIds: [],
      completedWorkItemIds: [],
    }),
  }) as never;

const buildRunnerWorkerClient = (
  expectedWorkItemIds: string[],
  completedWorkItemIds: string[],
) =>
  ({
    getJobSessionEvents: async () => [
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
    resetStaleChildTasks: async () => ({ resetIds: [] }),
    getJobCompletionSnapshot: async (jobId: string) => ({
      jobId,
      rootWorkItemId: null,
      expectedWorkItemIds,
      completedWorkItemIds,
    }),
  }) as never;

const containerManager = {} as never;
const eventLogger = {
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
} as never;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe("evaluateCompletion PR guarantees", () => {
  it("creates a late PR even when PR-first metadata is missing", async () => {
    globalThis.fetch = (async (input, init) => {
      const url = String(input);
      if (url.endsWith("/api/github/pull-requests") && init?.method === "POST") {
        return new Response(
          JSON.stringify({ data: { prUrl: "https://github.com/org/repo/pull/7", prNumber: 7 } }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }

      if (url.endsWith("/api/github/pull-requests/7") && init?.method === "PATCH") {
        return new Response(JSON.stringify({ success: true }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }

      throw new Error(`Unexpected fetch: ${url} ${init?.method ?? "GET"}`);
    }) as typeof fetch;

    const result = await evaluateCompletion(
      { workerClient: buildWorkerClient(), containerManager },
      {
        job: { id: "job-123" } as never,
        result: { success: true, summary: "done" },
        skillName: "implement",
        pushSucceeded: true,
        requiresPush: true,
        prFirstResult: null,
        eventLogger,
        startedAtMs: Date.now() - 1000,
        containerId: null,
        extractedBranchName: "almirant/item-1234",
        baseBranch: "main",
        workItem: null,
        injectedEnvRepoUrl: "https://github.com/org/repo",
        workerId: "worker-1",
        apiBaseUrl: "https://api.example.com",
        apiKey: "secret",
      },
    );

    expect(result.result.success).toBe(true);
    expect(result.jobCompleted).toBe(true);
    expect(result.prResult?.branchName).toBe("almirant/item-1234");
    expect(result.prResult?.prNumber).toBe(7);
    expect(result.prResult?.prUrl).toBe("https://github.com/org/repo/pull/7");
  });

  it("fails finalization when changes were pushed but no PR could be created", async () => {
    globalThis.fetch = (async (input, init) => {
      const url = String(input);
      if (url.endsWith("/api/github/pull-requests") && init?.method === "POST") {
        return new Response("server error", { status: 500 });
      }

      throw new Error(`Unexpected fetch: ${url} ${init?.method ?? "GET"}`);
    }) as typeof fetch;

    const result = await evaluateCompletion(
      { workerClient: buildWorkerClient(), containerManager },
      {
        job: { id: "job-456" } as never,
        result: { success: true, summary: "done" },
        skillName: "implement",
        pushSucceeded: true,
        requiresPush: true,
        prFirstResult: null,
        eventLogger,
        startedAtMs: Date.now() - 1000,
        containerId: null,
        extractedBranchName: "almirant/item-9999",
        baseBranch: "main",
        workItem: null,
        injectedEnvRepoUrl: "https://github.com/org/repo",
        workerId: "worker-1",
        apiBaseUrl: "https://api.example.com",
        apiKey: "secret",
      },
    );

    expect(result.result.success).toBe(false);
    expect(result.jobCompleted).toBe(false);
    expect(result.prResult).toBeNull();
    expect(result.result.errorMessage).toContain("no pull request exists");
  });

  it("marks runner-implement PR ready when summary and deterministic side effects replace a missing DONE marker", async () => {
    const patchBodies: Array<Record<string, unknown>> = [];
    globalThis.fetch = (async (input, init) => {
      const url = String(input);
      if (url.endsWith("/api/github/pull-requests/17") && init?.method === "PATCH") {
        patchBodies.push(JSON.parse(String(init.body)) as Record<string, unknown>);
        return new Response(JSON.stringify({ success: true }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }

      throw new Error(`Unexpected fetch: ${url} ${init?.method ?? "GET"}`);
    }) as typeof fetch;

    const result = await evaluateCompletion(
      {
        workerClient: buildRunnerWorkerClient(["wi-1", "wi-2"], ["wi-1", "wi-2"]),
        containerManager,
      },
      {
        job: { id: "job-runner-1", skillName: "runner-implement" } as never,
        result: {
          success: true,
          summary: "## Summary\n- Completed all tasks\n- PR: https://github.com/org/repo/pull/17",
        },
        skillName: "runner-implement",
        pushSucceeded: true,
        requiresPush: true,
        prFirstResult: {
          branchName: "almirant/A-1",
          baseBranch: "main",
          prUrl: "https://github.com/org/repo/pull/17",
          prNumber: 17,
          prCreatedByThisJob: true,
        },
        eventLogger,
        startedAtMs: Date.now() - 300_000,
        containerId: null,
        extractedBranchName: "almirant/A-1",
        baseBranch: "main",
        injectedEnvRepoUrl: "https://github.com/org/repo",
        workerId: "worker-1",
        apiBaseUrl: "https://api.example.com",
        apiKey: "secret",
      },
    );

    expect(result.result.success).toBe(true);
    expect(result.jobCompleted).toBe(true);
    expect(patchBodies).toContainEqual({
      repoFullName: "org/repo",
      body: "## Summary\n- Completed all tasks\n- PR: https://github.com/org/repo/pull/17",
    });
    expect(patchBodies).toContainEqual({
      repoFullName: "org/repo",
      draft: false,
    });
  });

  it("updates runner-implement PR summary even when the PR must remain draft", async () => {
    const patchBodies: Array<Record<string, unknown>> = [];
    globalThis.fetch = (async (input, init) => {
      const url = String(input);
      if (url.endsWith("/api/github/pull-requests/18") && init?.method === "PATCH") {
        patchBodies.push(JSON.parse(String(init.body)) as Record<string, unknown>);
        return new Response(JSON.stringify({ success: true }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }

      throw new Error(`Unexpected fetch: ${url} ${init?.method ?? "GET"}`);
    }) as typeof fetch;

    const result = await evaluateCompletion(
      {
        workerClient: buildRunnerWorkerClient(["wi-1", "wi-2"], ["wi-1"]),
        containerManager,
      },
      {
        job: { id: "job-runner-2", skillName: "runner-implement" } as never,
        result: {
          success: true,
          summary: "## Summary\n- Partially completed tasks",
        },
        skillName: "runner-implement",
        pushSucceeded: true,
        requiresPush: true,
        prFirstResult: {
          branchName: "almirant/A-2",
          baseBranch: "main",
          prUrl: "https://github.com/org/repo/pull/18",
          prNumber: 18,
          prCreatedByThisJob: true,
        },
        eventLogger,
        startedAtMs: Date.now() - 300_000,
        containerId: null,
        extractedBranchName: "almirant/A-2",
        baseBranch: "main",
        injectedEnvRepoUrl: "https://github.com/org/repo",
        workerId: "worker-1",
        apiBaseUrl: "https://api.example.com",
        apiKey: "secret",
      },
    );

    expect(result.result.success).toBe(false);
    expect(result.jobCompleted).toBe(false);
    expect(patchBodies).toEqual([
      {
        repoFullName: "org/repo",
        body: "## Summary\n- Partially completed tasks",
      },
    ]);
  });
});

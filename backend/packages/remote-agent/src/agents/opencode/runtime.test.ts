import { describe, expect, it } from "bun:test";
import { createOpenCodeRuntime } from "./runtime";

describe("OpenCodeRuntime", () => {
  it("builds container config with work item env", async () => {
    const runtime = createOpenCodeRuntime();

    const container = await runtime.buildContainerConfig({
      workItem: {
        id: "wi-1",
        taskId: "A-1",
        title: "Test",
        description: null,
        boardId: "board-1",
        boardColumnId: "col-1",
        projectId: null,
        parentId: null,
        type: "task",
        priority: "high",
        metadata: null,
        estimatedHours: null,
      },
      repositoryPath: "/repo/path",
    });

    expect(container.envVars.ALMIRANT_WORK_ITEM_ID).toBe("wi-1");
    expect(container.volumes[0]?.source).toBe("/repo/path");
  });

  it("treats output as raw transcript text", () => {
    const runtime = createOpenCodeRuntime();
    const event = runtime.parseOutput("Running checks");

    expect(event).toEqual({
      type: "raw",
      line: "Running checks",
    });
  });

  it("tracks active session info", async () => {
    const runtime = createOpenCodeRuntime(
      { defaultProvider: "opencode" },
      {
        serveManager: {
          start: async () => ({
            baseUrl: "http://localhost:4096",
            port: 4096,
            ownedProcess: false,
          }),
          stop: async () => undefined,
          getConnection: () => ({
            baseUrl: "http://localhost:4096",
            port: 4096,
            ownedProcess: false,
          }),
          healthCheck: async () => true,
        } as any,
        sessionManagerFactory: () =>
          ({
            createSession: async () => ({
              id: "session-1",
              createdAt: "2026-03-01T00:00:00.000Z",
              model: "gpt-5",
            }),
            resumeSession: async () => ({ id: "session-1" }),
            sendPrompt: async () => ({ ok: true }),
            streamSessionEvents: async function* () {
              yield { data: "hello", raw: "data: hello" };
            },
            healthCheck: async () => true,
          }) as any,
      }
    );

    await runtime.createSession({ cwd: "/repo" });
    const session = await runtime.getSessionInfo();

    expect(session?.sessionId).toBe("session-1");
    expect((session as any)?.provider).toBe("opencode");
    expect(await runtime.healthCheck()).toBe(true);
  });
});

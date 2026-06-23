import { describe, expect, it } from "bun:test";
import {
  buildStageUserChangesCommand,
  buildUnstageRunnerManagedPathsCommand,
  isProtectedPushBranch,
  releasePrimarySession,
} from "../src/delivery/push-pipeline";
import type { RunnerJobEventLogger } from "../src/observability/job-event-logger";

describe("isProtectedPushBranch", () => {
  it("blocks protected default branches", () => {
    expect(isProtectedPushBranch("main")).toBe(true);
    expect(isProtectedPushBranch("master")).toBe(true);
  });

  it("allows feature branches created for runner jobs", () => {
    expect(isProtectedPushBranch("almirant/A-1720")).toBe(false);
    expect(isProtectedPushBranch("feature/fix-runner-timeout")).toBe(false);
  });
});

describe("post-session staging commands", () => {
  it("unstages runner-managed files before creating a safety-net commit", () => {
    const command = buildUnstageRunnerManagedPathsCommand();

    expect(command).toContain("git reset -q --");
    expect(command).toContain("'.mcp.json'");
    expect(command).toContain("'CLAUDE.md'");
    expect(command).toContain("'AGENTS.md'");
    expect(command).toContain("'opencode.json'");
    expect(command).toContain("'.claude'");
    expect(command).toContain("'.agents'");
    expect(command.startsWith("(")).toBe(true);
    expect(command.endsWith(")")).toBe(true);
  });

  it("stages user changes while excluding runner-managed MCP/config files", () => {
    const command = buildStageUserChangesCommand();

    expect(command.startsWith("git add -A -- .")).toBe(true);
    expect(command).not.toBe("git add -A");
    expect(command).toContain("':(exclude).mcp.json'");
    expect(command).toContain("':(exclude)CLAUDE.md'");
    expect(command).toContain("':(exclude)AGENTS.md'");
    expect(command).toContain("':(exclude)opencode.json'");
    expect(command).toContain("':(exclude).claude/**'");
    expect(command).toContain("':(exclude).agents/**'");
  });
});

// ---------------------------------------------------------------------------
// releasePrimarySession
// ---------------------------------------------------------------------------

type LoggedCall = { level: string; eventType: string; payload?: Record<string, unknown> };

const createFakeEventLogger = (): {
  logger: RunnerJobEventLogger;
  calls: LoggedCall[];
} => {
  const calls: LoggedCall[] = [];
  const push = (level: string) => (
    _phase: string,
    eventType: string,
    _message: string,
    payload?: Record<string, unknown>,
  ) => {
    calls.push({ level, eventType, payload });
  };
  const fake = {
    debug: push("debug"),
    info: push("info"),
    warn: push("warn"),
    error: push("error"),
  };
  return { logger: fake as unknown as RunnerJobEventLogger, calls };
};

describe("releasePrimarySession", () => {
  it("calls deleteSession with the primary session id when serve URL is set", async () => {
    const { logger, calls } = createFakeEventLogger();
    const deleteCalls: string[] = [];

    const result = await releasePrimarySession({
      jobId: "job-1",
      sessionId: "primary-sess-abc",
      containerServeBaseUrl: "http://container-serve:4096",
      eventLogger: logger,
      sessionManagerFactory: (baseUrl) => {
        expect(baseUrl).toBe("http://container-serve:4096");
        return {
          deleteSession: async (sessionId: string) => {
            deleteCalls.push(sessionId);
          },
        };
      },
    });

    expect(result).toBe(true);
    expect(deleteCalls).toEqual(["primary-sess-abc"]);
    expect(calls).toContainEqual({
      level: "info",
      eventType: "session.primary_deleted",
      payload: { sessionId: "primary-sess-abc" },
    });
  });

  it("is a no-op when containerServeBaseUrl is null (no serve to call)", async () => {
    const { logger, calls } = createFakeEventLogger();
    let factoryCalled = false;

    const result = await releasePrimarySession({
      jobId: "job-1",
      sessionId: "primary-sess-abc",
      containerServeBaseUrl: null,
      eventLogger: logger,
      sessionManagerFactory: () => {
        factoryCalled = true;
        return { deleteSession: async () => undefined };
      },
    });

    expect(result).toBe(false);
    expect(factoryCalled).toBe(false);
    expect(calls).toHaveLength(0);
  });

  it("is a no-op when sessionId is empty", async () => {
    const { logger, calls } = createFakeEventLogger();

    const result = await releasePrimarySession({
      jobId: "job-1",
      sessionId: "",
      containerServeBaseUrl: "http://container-serve:4096",
      eventLogger: logger,
    });

    expect(result).toBe(false);
    expect(calls).toHaveLength(0);
  });

  it("swallows errors and returns false when deleteSession throws — push must not fail on teardown", async () => {
    const { logger, calls } = createFakeEventLogger();

    const result = await releasePrimarySession({
      jobId: "job-1",
      sessionId: "primary-sess-abc",
      containerServeBaseUrl: "http://container-serve:4096",
      eventLogger: logger,
      sessionManagerFactory: () => ({
        deleteSession: async () => {
          throw new Error("serve unreachable");
        },
      }),
    });

    expect(result).toBe(false);
    const warnCall = calls.find((c) => c.eventType === "session.primary_delete_failed");
    expect(warnCall).toBeDefined();
    expect(warnCall?.level).toBe("warn");
    expect(warnCall?.payload?.sessionId).toBe("primary-sess-abc");
    expect(String(warnCall?.payload?.errorMessage)).toContain("serve unreachable");
  });
});

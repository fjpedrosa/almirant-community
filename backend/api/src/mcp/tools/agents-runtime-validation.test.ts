import { afterAll, describe, expect, it, spyOn } from "bun:test";
import * as database from "@almirant/database";

type ToolResult = {
  content: Array<{ type: "text"; text: string }>;
  isError?: boolean;
};

type ToolHandler = (
  params: Record<string, unknown>,
  extra: Record<string, unknown>,
) => Promise<ToolResult>;

const createSpy = spyOn(database, "createScheduledAgentConfig").mockImplementation(
  (async () => {
    throw new Error("createScheduledAgentConfig must not run for an invalid model");
  }) as never,
);

afterAll(() => createSpy.mockRestore());

describe("agents MCP runtime validation", () => {
  it("fails closed for an explicit model slug absent from the provider entitlement", async () => {
    const tools = new Map<string, ToolHandler>();
    const fakeServer = {
      tool: (
        name: string,
        _description: string,
        _schema: unknown,
        handler: ToolHandler,
      ) => {
        tools.set(name, handler);
      },
    };
    const { registerAgentsTools } = await import("./agents.tools");
    registerAgentsTools(fakeServer as never);

    const handler = tools.get("create_agent");
    expect(handler).toBeDefined();
    const result = await handler!(
      {
        name: "Invalid model",
        jobType: "implementation",
        provider: "zipu",
        codingAgent: "opencode",
        aiProvider: "zai",
        aiModel: "totally-not-a-model",
        scheduleType: "manual",
      },
      {
        authInfo: {
          extra: {
            workspaceId: "org-test-1",
            projectId: "project-test-1",
            userId: "user-test-1",
          },
        },
      },
    );

    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toMatch(/unknown|unsupported|not available/i);
    expect(createSpy).not.toHaveBeenCalled();
  });
});

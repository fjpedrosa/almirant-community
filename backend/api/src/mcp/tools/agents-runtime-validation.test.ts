import { afterAll, beforeEach, describe, expect, it, spyOn } from "bun:test";
import * as database from "@almirant/database";

type ToolResult = {
  content: Array<{ type: "text"; text: string }>;
  isError?: boolean;
};

type ToolHandler = (
  params: Record<string, unknown>,
  extra: Record<string, unknown>,
) => Promise<ToolResult>;

type ValueParser = {
  safeParse: (value: unknown) => { success: boolean };
};

type ToolSchema = Record<string, ValueParser>;

const createSpy = spyOn(database, "createScheduledAgentConfig").mockImplementation(
  (async (input: Record<string, unknown>) => ({
    id: "agent-test-1",
    ...input,
  })) as never,
);

const authExtra = {
  authInfo: {
    extra: {
      workspaceId: "org-test-1",
      projectId: "project-test-1",
      userId: "user-test-1",
    },
  },
};

const buildRegistry = async () => {
  const tools = new Map<string, ToolHandler>();
  const schemas = new Map<string, ToolSchema>();
  const fakeServer = {
    tool: (
      name: string,
      _description: string,
      schema: ToolSchema,
      handler: ToolHandler,
    ) => {
      tools.set(name, handler);
      schemas.set(name, schema);
    },
  };
  const { registerAgentsTools } = await import("./agents.tools");
  registerAgentsTools(fakeServer as never);
  return { tools, schemas };
};

beforeEach(() => createSpy.mockClear());
afterAll(() => createSpy.mockRestore());

describe("agents MCP runtime validation", () => {
  it("derives known modern validators from the projection and keeps codex-cli legacy-only", async () => {
    const { schemas } = await buildRegistry();
    const schema = schemas.get("create_agent")!;

    for (const codingAgent of ["claude-code", "codex", "opencode", "pi"]) {
      expect(schema.codingAgent!.safeParse(codingAgent).success).toBe(true);
    }
    expect(schema.codingAgent!.safeParse("codex-cli").success).toBe(false);

    for (const aiProvider of ["anthropic", "google", "openai", "xai", "zai"]) {
      expect(schema.aiProvider!.safeParse(aiProvider).success).toBe(true);
    }
  });

  it("fails closed for an explicit model slug absent from the provider entitlement", async () => {
    const { tools } = await buildRegistry();
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
      authExtra,
    );

    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toMatch(/unknown|unsupported|not available/i);
    expect(createSpy).not.toHaveBeenCalled();
  });

  it("returns Pi's typed disabled admission before persistence, including Google", async () => {
    const { tools } = await buildRegistry();
    const handler = tools.get("create_agent")!;

    const result = await handler(
      {
        name: "Disabled Pi agent",
        jobType: "implementation",
        provider: "claude-code",
        codingAgent: "pi",
        aiProvider: "google",
        aiModel: "gemini-3.1-pro-preview",
        scheduleType: "manual",
      },
      authExtra,
    );

    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain("RUNTIME_ADMISSION_DISABLED");
    expect(createSpy).not.toHaveBeenCalled();
  });

  it("validates create_agent after browser/tooling augmentation and keeps no-capability Pi enabled", async () => {
    const { tools } = await buildRegistry();
    const handler = tools.get("create_agent")!;
    const base = {
      name: "Pi agent",
      jobType: "implementation",
      provider: "zipu",
      codingAgent: "pi",
      aiProvider: "zai",
      aiModel: "glm-5.3",
      scheduleType: "manual",
    };

    const accepted = await handler(base, authExtra);
    expect(accepted.isError).toBeUndefined();
    expect(createSpy).toHaveBeenCalledTimes(1);

    createSpy.mockClear();
    const rejected = await handler({ ...base, needsBrowser: true }, authExtra);
    expect(rejected.isError).toBe(true);
    expect(rejected.content[0]?.text).toContain("PI_CAPABILITY_BROWSER_DISABLED");
    expect(createSpy).not.toHaveBeenCalled();

    const pluginRejected = await handler({
      ...base,
      targetConfig: {
        customFilters: {
          __agentTooling: {
            selectedPluginIds: ["9c1f6f0e-9b7e-4b8a-8b0e-7f6c2e5a1d33"],
          },
        },
      },
    }, authExtra);
    expect(pluginRejected.isError).toBe(true);
    expect(pluginRejected.content[0]?.text).toContain("PI_CAPABILITY_EXTENSIONS_DISABLED");
    expect(createSpy).not.toHaveBeenCalled();
  });

  it("preserves admission and persistence for existing coding-agent families", async () => {
    const { tools } = await buildRegistry();
    const handler = tools.get("create_agent")!;
    const existingRuntimes = [
      {
        name: "Claude agent",
        provider: "claude-code",
        codingAgent: "claude-code",
        aiProvider: "anthropic",
        aiModel: "claude-opus-4-8",
      },
      {
        name: "Codex agent",
        provider: "codex",
        codingAgent: "codex",
        aiProvider: "openai",
        aiModel: "gpt-5.6-sol",
      },
      {
        name: "OpenCode agent",
        provider: "zipu",
        codingAgent: "opencode",
        aiProvider: "zai",
        aiModel: "glm-5.2",
      },
    ];

    for (const runtime of existingRuntimes) {
      const result = await handler(
        {
          ...runtime,
          jobType: "implementation",
          scheduleType: "manual",
        },
        authExtra,
      );
      expect(result.isError).toBeUndefined();
    }

    expect(createSpy).toHaveBeenCalledTimes(existingRuntimes.length);
  });
});

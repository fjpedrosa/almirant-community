import { describe, expect, it, mock } from "bun:test";
import {
  AgentOutputCapabilityDeniedError,
  AgentOutputValidationError,
  type AgentOutputCapabilityService,
} from "../../domains/agents/services/agent-output-capability";
import { registerAgentOutputTools } from "./agent-output.tools";

type Handler = (
  params: Record<string, unknown>,
  extra: Record<string, unknown>,
) => Promise<{
  content: Array<{ type: "text"; text: string }>;
  isError?: boolean;
}>;

const authExtra = {
  authInfo: {
    extra: {
      jobId: "10000000-0000-4000-8000-000000000001",
      projectId: "20000000-0000-4000-8000-000000000002",
      workspaceId: "workspace-output",
      permissions: ["mcp:write"],
      sessionType: "agent",
    },
  },
};

describe("agent output MCP tool", () => {
  it("registers submit_agent_output and derives all capability scope from authInfo", async () => {
    const tools = new Map<string, Handler>();
    const submit = mock(async () => ({
      submissionId: "submission-1",
      status: "submitted" as const,
      replay: false,
    }));
    registerAgentOutputTools(
      {
        tool: (
          name: string,
          _description: string,
          _schema: unknown,
          handler: Handler,
        ) => tools.set(name, handler),
      } as never,
      { submit } as AgentOutputCapabilityService,
    );

    expect([...tools.keys()]).toEqual(["submit_agent_output"]);
    const handler = tools.get("submit_agent_output");
    if (!handler) throw new Error("submit_agent_output was not registered");
    const result = await handler(
      {
        output: { answer: "ok" },
        jobId: "forged-job",
        workspaceId: "forged-workspace",
        permissions: ["admin:*"],
        sessionType: "admin",
      },
      authExtra,
    );

    expect(submit).toHaveBeenCalledWith(
      {
        jobId: "10000000-0000-4000-8000-000000000001",
        workspaceId: "workspace-output",
        permissions: ["mcp:write"],
        sessionType: "agent",
      },
      { answer: "ok" },
    );
    expect(JSON.stringify(result)).not.toContain('"answer"');
    expect(JSON.stringify(result)).not.toContain("ok");
  });

  it("tells the agent which fields violate the schema so it can correct itself", async () => {
    const tools = new Map<string, Handler>();
    // A blocked store leaves optional fields without evidence, and an agent that
    // refuses to invent data sends null. `images`/`attributes`/`bulletPoints` are
    // array/object without null, so validation fails — and a generic rejection
    // made the agent retry the same shape seven times instead of fixing it.
    const failure = new AgentOutputValidationError(
      "Structured output violates the snapshotted schema",
    );
    failure.details = [
      "/products/0/images: type must be array",
      "/products/0/attributes: type must be object",
    ];
    registerAgentOutputTools(
      {
        tool: (
          name: string,
          _description: string,
          _schema: unknown,
          handler: Handler,
        ) => tools.set(name, handler),
      } as never,
      {
        submit: async () => {
          throw failure;
        },
      } as AgentOutputCapabilityService,
    );
    const handler = tools.get("submit_agent_output");
    if (!handler) throw new Error("submit_agent_output was not registered");

    const result = await handler(
      { output: { products: [{ images: null }] } },
      authExtra,
    );

    expect(result.isError).toBe(true);
    const body = JSON.parse(result.content[0]?.text ?? "{}") as {
      error: string;
      details?: string[];
    };
    expect(body.details).toEqual([
      "/products/0/images: type must be array",
      "/products/0/attributes: type must be object",
    ]);
    // The log must name the failure class, or a denial and a schema violation
    // are indistinguishable in production.
    expect(failure.name).toBe("AgentOutputValidationError");
  });

  it("keeps authorization failures opaque while still reporting them", async () => {
    const tools = new Map<string, Handler>();
    registerAgentOutputTools(
      {
        tool: (
          name: string,
          _description: string,
          _schema: unknown,
          handler: Handler,
        ) => tools.set(name, handler),
      } as never,
      {
        submit: async () => {
          throw new AgentOutputCapabilityDeniedError(
            "Agent output capability denied",
          );
        },
      } as AgentOutputCapabilityService,
    );
    const handler = tools.get("submit_agent_output");
    if (!handler) throw new Error("submit_agent_output was not registered");

    const result = await handler({ output: { answer: "x" } }, authExtra);

    expect(result.isError).toBe(true);
    // Authorization detail must never cross the boundary: no field-level hints.
    expect(result.content[0]?.text).toBe(
      JSON.stringify({ error: "Structured agent output was rejected" }),
    );
    expect(JSON.stringify(result)).not.toContain("capability denied");
  });

  it("returns a stable redacted error instead of leaking validation details", async () => {
    const tools = new Map<string, Handler>();
    registerAgentOutputTools(
      {
        tool: (
          name: string,
          _description: string,
          _schema: unknown,
          handler: Handler,
        ) => tools.set(name, handler),
      } as never,
      {
        submit: async () => {
          throw new Error("secret payload token");
        },
      } as AgentOutputCapabilityService,
    );
    const handler = tools.get("submit_agent_output");
    if (!handler) throw new Error("submit_agent_output was not registered");

    const result = await handler({ output: { answer: "bad" } }, authExtra);

    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toBe(
      JSON.stringify({ error: "Structured agent output was rejected" }),
    );
    expect(JSON.stringify(result)).not.toContain("secret payload token");
  });
});

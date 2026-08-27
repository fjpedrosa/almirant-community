import { describe, expect, it } from "bun:test";
import { Elysia } from "elysia";
import {
  runtimeCapabilityProjection as RUNTIME_CAPABILITY_PROJECTION,
} from "@almirant/shared";
import { runtimeCapabilitiesRoutes } from "../../domains/agents/routes/runtime-capabilities.routes";
import { registerAgentsTools } from "./agents.tools";

type ToolResult = {
  content: Array<{ type: "text"; text: string }>;
  isError?: boolean;
};

type ToolHandler = (
  params: Record<string, unknown>,
  extra: Record<string, unknown>,
) => Promise<ToolResult>;

const mcpExtra = {
  authInfo: {
    extra: {
      workspaceId: "org-test-1",
      userId: "user-test-1",
    },
  },
};

const staticProjectionBytes = JSON.stringify(RUNTIME_CAPABILITY_PROJECTION);

const withPiAdmissionEnvironment = async <T>(
  value: "true" | "false" | undefined,
  action: () => Promise<T>,
): Promise<T> => {
  const previous = process.env.PI_CODING_AGENT_ADMISSION_ENABLED;
  if (value === undefined) {
    delete process.env.PI_CODING_AGENT_ADMISSION_ENABLED;
  } else {
    process.env.PI_CODING_AGENT_ADMISSION_ENABLED = value;
  }
  try {
    return await action();
  } finally {
    if (previous === undefined) {
      delete process.env.PI_CODING_AGENT_ADMISSION_ENABLED;
    } else {
      process.env.PI_CODING_AGENT_ADMISSION_ENABLED = previous;
    }
  }
};

const getRestProjection = async (): Promise<unknown> => {
  const app = new Elysia()
    .derive(() => ({
      user: { id: "user-test-1" } as never,
      activeWorkspace: { id: "org-test-1" } as never,
      memberRole: "owner",
    }))
    .use(runtimeCapabilitiesRoutes);
  const response = await app.handle(
    new Request("http://localhost/runtime-capabilities/"),
  );
  expect(response.status).toBe(200);
  return response.json();
};

const buildAgentsTools = (): Map<string, ToolHandler> => {
  const tools = new Map<string, ToolHandler>();
  registerAgentsTools({
    tool: (
      name: string,
      _description: string,
      _schema: unknown,
      handler: ToolHandler,
    ) => {
      tools.set(name, handler);
    },
  } as never);
  return tools;
};

const getMcpProjection = async (): Promise<unknown> => {
  const handler = buildAgentsTools().get("get_runtime_capabilities");
  expect(handler).toBeDefined();
  const result = await handler!({}, mcpExtra);
  expect(result.isError).toBeUndefined();
  return JSON.parse(result.content[0]!.text);
};

const collectKeys = (value: unknown, keys: string[] = []): string[] => {
  if (Array.isArray(value)) {
    for (const entry of value) collectKeys(entry, keys);
    return keys;
  }
  if (typeof value !== "object" || value === null) return keys;

  for (const [key, entry] of Object.entries(value)) {
    keys.push(key);
    collectKeys(entry, keys);
  }
  return keys;
};

describe("runtime capability REST/MCP projection contract", () => {
  it.each([
    ["default", undefined, true, "PI_ADMISSION_ENABLED"],
    ["enabled", "true", true, "PI_ADMISSION_ENABLED"],
    ["disabled", "false", false, "PI_ADMISSION_DISABLED"],
  ] as const)(
    "keeps REST and MCP in deep parity for %s admission without changing the static projection",
    async (_label, admissionValue, enabled, code) =>
      withPiAdmissionEnvironment(admissionValue, async () => {
        const [restProjection, mcpProjection] = await Promise.all([
          getRestProjection(),
          getMcpProjection(),
        ]);
        const expectedProjection = {
          ...RUNTIME_CAPABILITY_PROJECTION,
          runtimeControls: {
            piCodingAgentAdmission: { enabled, code },
          },
        };

        expect(restProjection).toEqual(expectedProjection);
        expect(mcpProjection).toEqual(expectedProjection);
        expect(mcpProjection).toEqual(restProjection);
        expect(JSON.stringify(RUNTIME_CAPABILITY_PROJECTION)).toBe(
          staticProjectionBytes,
        );
        expect(RUNTIME_CAPABILITY_PROJECTION).not.toHaveProperty("runtimeControls");
      }),
  );

  it("requires authenticated MCP workspace context", async () => {
    const handler = buildAgentsTools().get("get_runtime_capabilities")!;

    const result = await handler({}, {});

    expect(result.isError).toBe(true);
    expect(result.content[0]!.text).toMatch(/workspace|organization|scope/i);
  });

  it("includes the canonical identity/hash without secret-like material", () => {
    expect(RUNTIME_CAPABILITY_PROJECTION).toMatchObject({
      schemaVersion: "runtime-capability-projection-v1",
      version: 1,
    });
    expect(RUNTIME_CAPABILITY_PROJECTION.hash).toMatch(
      /^sha256:[a-f0-9]{64}$/,
    );

    const keys = collectKeys(RUNTIME_CAPABILITY_PROJECTION);
    expect(
      keys.some((key) =>
        /^(?:api_?key|secret|token|credential|password)s?$/i.test(key),
      ),
    ).toBe(false);

    const serialized = JSON.stringify(RUNTIME_CAPABILITY_PROJECTION);
    for (const secretPattern of [
      /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
      /\bsk-(?:live|test|proj)-[A-Za-z0-9_-]{8,}/,
      /\bgh[pousr]_[A-Za-z0-9]{20,}/,
      /\bBearer\s+[A-Za-z0-9._-]{16,}/i,
    ]) {
      expect(serialized).not.toMatch(secretPattern);
    }
  });
});

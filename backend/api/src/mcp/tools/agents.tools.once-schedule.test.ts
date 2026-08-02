import { afterAll, describe, expect, it, mock } from "bun:test";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { createDatabaseMocks, restoreRealModules } from "../../test/mocks";
import { scheduleConfigSchema } from "./agents.tools";

// ---------------------------------------------------------------------------
// scheduleConfigSchema — Zod contract for scheduleType='once' (issue T2.2).
// Exercises the schema directly (bypassing the MCP SDK's own parse step,
// which the handler-level tests below bypass too) since these are the exact
// rules `create_agent`/`update_agent` enforce on `scheduleConfig` before the
// handler ever runs. Must agree with the REST route's TypeBox equivalent
// (scheduled-agents.routes.ts's onceConfigSchema, format: "date-time").
// ---------------------------------------------------------------------------

describe("scheduleConfigSchema — 'once' shape", () => {
  it("accepts a UTC ('Z') runAt", () => {
    expect(scheduleConfigSchema.safeParse({ runAt: "2026-08-05T09:00:00.000Z" }).success).toBe(true);
  });

  it("accepts a runAt with a numeric timezone offset", () => {
    expect(scheduleConfigSchema.safeParse({ runAt: "2026-08-05T09:00:00+02:00" }).success).toBe(true);
  });

  it("accepts a PAST runAt — creating with a past runAt is allowed", () => {
    expect(scheduleConfigSchema.safeParse({ runAt: "2020-01-01T00:00:00Z" }).success).toBe(true);
  });

  it("rejects a missing runAt", () => {
    expect(scheduleConfigSchema.safeParse({}).success).toBe(false);
  });

  it("rejects a non-ISO runAt string", () => {
    expect(scheduleConfigSchema.safeParse({ runAt: "not-a-date" }).success).toBe(false);
  });

  it("rejects a date-only string (missing time component)", () => {
    expect(scheduleConfigSchema.safeParse({ runAt: "2026-08-05" }).success).toBe(false);
  });

  it("still accepts the pre-existing cron and time_window shapes", () => {
    expect(scheduleConfigSchema.safeParse({ expression: "*/5 * * * *" }).success).toBe(true);
    expect(
      scheduleConfigSchema.safeParse({ startHour: 9, endHour: 17, daysOfWeek: [1, 2] }).success,
    ).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Handler-level behavior — required runAt on create, and the "no magia"
// re-enable rule on update: updating a fired (auto-disabled) 'once' config
// must NOT silently re-enable it. It only re-enables when the caller
// explicitly sets enabled: true.
// ---------------------------------------------------------------------------

const state = {
  createdInput: null as Record<string, unknown> | null,
  updatedInput: null as Record<string, unknown> | null,
};

const workspaceId = "workspace-once-1";
const ownerUserId = "owner-once-1";

// A 'once' agent that already fired: enabled was flipped to false by
// updateScheduledAgentConfigLastRunAt's auto-disable after its single dispatch.
const firedOnceAgent = {
  id: "33333333-3333-4333-8333-333333333333",
  workspaceId,
  ownerUserId,
  projectId: null,
  name: "Friday 09:00 one-shot",
  prompt: "Run the release checklist",
  description: null,
  jobType: "scheduled" as const,
  provider: "claude-code" as const,
  codingAgent: "claude-code",
  aiProvider: "anthropic",
  aiModel: "claude-sonnet-4-5",
  reasoningLevel: null,
  skillId: null,
  trigger: "scheduled" as const,
  webhookToken: null,
  scheduleType: "once" as const,
  scheduleConfig: { runAt: "2026-07-31T09:00:00.000Z" },
  timezone: "Europe/Madrid",
  enabled: false,
  targetConfig: {},
  mcpServers: null,
  maxJobsPerRun: 10,
  pausedUntil: null,
  lastRunAt: new Date("2026-07-31T09:00:03.000Z"),
  createdAt: new Date("2026-07-20T00:00:00.000Z"),
  updatedAt: new Date("2026-07-31T09:00:03.000Z"),
};

mock.module("@almirant/database", () =>
  createDatabaseMocks({
    createScheduledAgentConfig: async (input: Record<string, unknown>) => {
      state.createdInput = input;
      return { ...firedOnceAgent, ...input };
    },
    getScheduledAgentConfigById: async (id: string, ws: string) =>
      id === firedOnceAgent.id && ws === firedOnceAgent.workspaceId ? firedOnceAgent : undefined,
    updateScheduledAgentConfig: async (
      _id: string,
      _ws: string,
      input: Record<string, unknown>,
    ) => {
      state.updatedInput = input;
      return { ...firedOnceAgent, ...input };
    },
    findActiveConnections: async () => [
      { config: { implementationModel: "claude-sonnet-4-5" } },
    ],
  }),
);

type ToolHandler = (
  params: Record<string, unknown>,
  extra: { authInfo?: { extra?: Record<string, unknown> } },
) => Promise<{ content: Array<{ type: string; text: string }>; isError?: boolean }>;

const loadHandlers = async (): Promise<Map<string, ToolHandler>> => {
  const handlers = new Map<string, ToolHandler>();
  const server = {
    tool: (name: string, ...args: unknown[]) => {
      const handler = args.at(-1);
      if (typeof handler === "function") {
        handlers.set(name, handler as ToolHandler);
      }
    },
  };
  const { registerAgentsTools } = await import("./agents.tools");
  registerAgentsTools(server as unknown as McpServer);
  return handlers;
};

const authExtra = {
  authInfo: {
    extra: { workspaceId, userId: ownerUserId },
  },
};

describe("agents MCP tools — scheduleType='once' (issue T2.2)", () => {
  it("create_agent requires scheduleConfig when scheduleType='once'", async () => {
    const handler = (await loadHandlers()).get("create_agent");
    expect(handler).toBeDefined();

    const result = await handler!(
      {
        name: "Missing runAt",
        jobType: "scheduled",
        provider: "claude-code",
        scheduleType: "once",
      },
      authExtra,
    );

    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toMatch(/scheduleConfig is required/);
  });

  it("create_agent persists scheduleType='once' with its runAt untouched", async () => {
    state.createdInput = null;
    const handler = (await loadHandlers()).get("create_agent");

    await handler!(
      {
        name: "Friday 09:00 one-shot",
        jobType: "scheduled",
        provider: "claude-code",
        scheduleType: "once",
        scheduleConfig: { runAt: "2026-08-07T09:00:00.000Z" },
        enabled: true,
      },
      authExtra,
    );

    expect(state.createdInput).toMatchObject({
      scheduleType: "once",
      scheduleConfig: { runAt: "2026-08-07T09:00:00.000Z" },
    });
  });

  // Regression coverage for the "silent schedule reset" bug: `update_agent`'s
  // `buildAgentInput` used to recompute the WHOLE schedule
  // (trigger/scheduleType/scheduleConfig) as soon as ANY of the three was
  // touched, defaulting an omitted `scheduleType` to 'manual'. That meant
  // sending only `scheduleConfig` (e.g. bumping a 'once' agent's `runAt`)
  // silently reset the agent to scheduleType='manual'/scheduleConfig=null —
  // REST never had this problem because it always merges against
  // `existing.scheduleType`. The fix mirrors that: when `scheduleType` isn't
  // part of THIS payload, the existing persisted scheduleType is preserved.
  it("update_agent preserves scheduleType when only scheduleConfig is sent — updates runAt in place, no reset", async () => {
    state.updatedInput = null;
    const handler = (await loadHandlers()).get("update_agent");

    await handler!(
      {
        id: firedOnceAgent.id,
        scheduleConfig: { runAt: "2026-08-10T09:00:00.000Z" },
      },
      authExtra,
    );

    expect(state.updatedInput).toMatchObject({
      scheduleType: "once",
      scheduleConfig: { runAt: "2026-08-10T09:00:00.000Z" },
    });
  });

  it("update_agent rejects a scheduleConfig whose shape doesn't match the preserved existing scheduleType", async () => {
    state.updatedInput = null;
    const handler = (await loadHandlers()).get("update_agent");

    // firedOnceAgent.scheduleType === 'once' (shape: { runAt }); sending a
    // cron-shaped config without an explicit scheduleType must be rejected
    // with a clear validation error instead of silently persisting a
    // mismatched scheduleType='once' + { expression } pair.
    const result = await handler!(
      {
        id: firedOnceAgent.id,
        scheduleConfig: { expression: "*/5 * * * *" },
      },
      authExtra,
    );

    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toMatch(/does not match this agent's existing scheduleType 'once'/);
    expect(state.updatedInput).toBeNull();
  });

  it("update_agent touching only `trigger` leaves the existing schedule intact (no reset)", async () => {
    state.updatedInput = null;
    const handler = (await loadHandlers()).get("update_agent");

    await handler!(
      {
        id: firedOnceAgent.id,
        trigger: "scheduled",
      },
      authExtra,
    );

    expect(state.updatedInput).toMatchObject({
      scheduleType: "once",
      scheduleConfig: { runAt: firedOnceAgent.scheduleConfig.runAt },
    });
  });

  it("update_agent honors an explicit scheduleType change to a different schedule shape (scheduleType always wins when present)", async () => {
    state.updatedInput = null;
    const handler = (await loadHandlers()).get("update_agent");

    // Legit flow: switching a 'once' agent to 'cron' by sending scheduleType
    // AND a cron-shaped scheduleConfig together. No shape cross-check
    // against the OLD (once) type applies here — scheduleType is explicit.
    await handler!(
      {
        id: firedOnceAgent.id,
        scheduleType: "cron",
        scheduleConfig: { expression: "0 9 * * 1-5" },
      },
      authExtra,
    );

    expect(state.updatedInput).toMatchObject({
      scheduleType: "cron",
      scheduleConfig: { expression: "0 9 * * 1-5" },
    });
  });

  it("update_agent changing runAt on a fired 'once' config (scheduleType + scheduleConfig together) does NOT re-enable it (no magia)", async () => {
    state.updatedInput = null;
    const handler = (await loadHandlers()).get("update_agent");

    await handler!(
      {
        id: firedOnceAgent.id,
        scheduleType: "once",
        scheduleConfig: { runAt: "2026-08-10T09:00:00.000Z" },
      },
      authExtra,
    );

    expect(state.updatedInput).toMatchObject({
      scheduleType: "once",
      scheduleConfig: { runAt: "2026-08-10T09:00:00.000Z" },
    });
    // No `enabled` key at all in the update payload — the repository layer
    // preserves the persisted (disabled) value untouched.
    expect(state.updatedInput).not.toHaveProperty("enabled");
  });

  it("update_agent re-enables a fired 'once' config only when the caller explicitly sets enabled: true alongside a future runAt", async () => {
    state.updatedInput = null;
    const handler = (await loadHandlers()).get("update_agent");

    await handler!(
      {
        id: firedOnceAgent.id,
        scheduleType: "once",
        scheduleConfig: { runAt: "2026-08-10T09:00:00.000Z" },
        enabled: true,
      },
      authExtra,
    );

    expect(state.updatedInput).toMatchObject({
      scheduleType: "once",
      scheduleConfig: { runAt: "2026-08-10T09:00:00.000Z" },
      enabled: true,
    });
  });
});

afterAll(() => {
  mock.restore();
  restoreRealModules();
});

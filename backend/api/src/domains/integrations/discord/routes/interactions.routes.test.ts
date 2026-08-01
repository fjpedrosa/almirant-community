import { afterAll, beforeEach, describe, expect, it, mock } from "bun:test";
import { Elysia } from "elysia";
import * as configExports from "@almirant/config";
import {
  createDatabaseMocks,
  createWsMock,
  restoreRealModules,
} from "../../../../test/mocks";
import { testWorkItem } from "../../../../test/fixtures";

// ---------------------------------------------------------------------------
// Real module snapshots — captured BEFORE mock.module() registration.
// Bun's mock.restore() does NOT clear mock.module() registrations, so we must
// re-register the originals in afterAll to avoid cross-file contamination.
// (@almirant/database and @almirant/config are handled by restoreRealModules.)
// ---------------------------------------------------------------------------
import * as realDiscordThread from "../services/discord-thread";
import * as realWsConnectionManager from "../../../../shared/ws/ws-connection-manager";

const state = {
  createdJobInput: null as Record<string, unknown> | null,
};

const dbMocks = createDatabaseMocks({
  getWorkItemByTaskIdExact: async (taskId: string) =>
    taskId === testWorkItem.taskId ? testWorkItem : null,
  // No Discord connection configured -> resolveDiscordChannel falls through to env (undefined).
  getDiscordConnectionByWorkspace: async () => null,
  createJob: async (input: Record<string, unknown>) => {
    state.createdJobInput = input;
    return {
      id: "job-discord-1",
      status: "queued",
      workItemId: testWorkItem.id,
      planningSessionId: null,
      workspaceId: "org-test-1",
      provider: input.provider,
      jobType: input.jobType ?? "implementation",
    };
  },
  // Minimal drizzle chain used by resolveWorkspaceIdForWorkItem:
  // db.select().from().innerJoin().where().limit()
  db: {
    select: () => ({
      from: () => ({
        innerJoin: () => ({
          where: () => ({
            limit: async () => [{ workspaceId: "org-test-1" }],
          }),
        }),
      }),
    }),
  },
});

mock.module("@almirant/database", () => dbMocks);
// Deterministic Discord env regardless of the local machine:
// - no DISCORD_PUBLIC_KEY -> signature verification is skipped
// - no DISCORD_BOT_TOKEN / DISCORD_CHANNEL_ID -> no thread creation fallback
mock.module("@almirant/config", () => ({
  ...configExports,
  env: {
    ...configExports.env,
    DISCORD_PUBLIC_KEY: undefined,
    DISCORD_BOT_TOKEN: undefined,
    DISCORD_CHANNEL_ID: undefined,
  },
}));
mock.module("../services/discord-thread", () => ({
  ...realDiscordThread,
  isDiscordBridgeConfigured: () => false,
  createDiscordThread: async () => null,
}));
mock.module("../../../../shared/ws/ws-connection-manager", () => createWsMock());

// queueCommandJob talks to the Discord webhook API (editOriginalResponse /
// sendFollowup) through global fetch. Stub it so no real network calls happen.
const realFetch = globalThis.fetch;
globalThis.fetch = (async () =>
  new Response("{}", {
    status: 200,
    headers: { "content-type": "application/json" },
  })) as unknown as typeof fetch;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const makeInteractionRequest = (
  options: Array<{ name: string; value: string }>,
  commandName: "implement" | "plan" = "implement"
): Request =>
  new Request("http://localhost/webhooks/discord/interactions", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      id: "interaction-test-1",
      type: 2, // APPLICATION_COMMAND
      token: "interaction-token-1",
      application_id: "discord-app-1",
      guild_id: "guild-1",
      channel_id: "channel-1",
      member: { user: { id: "discord-user-1" } },
      data: { name: commandName, options },
    }),
  });

/** queueCommandJob runs fire-and-forget after the deferred ACK; poll until done. */
const waitForJobCreation = async (timeoutMs = 2_000): Promise<void> => {
  const start = Date.now();
  while (state.createdJobInput === null) {
    if (Date.now() - start > timeoutMs) {
      throw new Error("Timed out waiting for createJob to be called");
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("discordInteractionsRoutes slash command runtime resolution", () => {
  beforeEach(() => {
    state.createdJobInput = null;
  });

  it("resolves the full codex runtime trio when no provider option is given (default provider)", async () => {
    const { discordInteractionsRoutes } = await import("./interactions.routes");
    const app = new Elysia().use(discordInteractionsRoutes);

    const res = await app.handle(
      makeInteractionRequest([{ name: "work_item_id", value: testWorkItem.taskId }])
    );

    expect(res.status).toBe(200);
    const body = (await res.json()) as { type: number };
    expect(body.type).toBe(5); // DEFERRED_CHANNEL_MESSAGE

    await waitForJobCreation();

    // resolveRuntime({ provider: "codex" }) => codex / openai / gpt-5.6-sol
    expect(state.createdJobInput).toMatchObject({
      provider: "codex",
      codingAgent: "codex",
      aiProvider: "openai",
      model: "gpt-5.6-sol",
    });
  });

  it("resolves the anthropic runtime trio when provider claude-code is explicit", async () => {
    const { discordInteractionsRoutes } = await import("./interactions.routes");
    const app = new Elysia().use(discordInteractionsRoutes);

    const res = await app.handle(
      makeInteractionRequest([
        { name: "work_item_id", value: testWorkItem.taskId },
        { name: "provider", value: "claude-code" },
      ])
    );

    expect(res.status).toBe(200);

    await waitForJobCreation();

    // resolveRuntime({ provider: "claude-code" }) => claude-code / anthropic / claude-opus-4-8
    expect(state.createdJobInput).toMatchObject({
      provider: "claude-code",
      codingAgent: "claude-code",
      aiProvider: "anthropic",
      model: "claude-opus-4-8",
    });
  });

  it("resolves the zai runtime trio when provider zipu is explicit", async () => {
    const { discordInteractionsRoutes } = await import("./interactions.routes");
    const app = new Elysia().use(discordInteractionsRoutes);

    const res = await app.handle(
      makeInteractionRequest([
        { name: "work_item_id", value: testWorkItem.taskId },
        { name: "provider", value: "zipu" },
      ])
    );

    expect(res.status).toBe(200);

    await waitForJobCreation();

    // resolveRuntime({ provider: "zipu" }) => opencode / zai / glm-5.2
    expect(state.createdJobInput).toMatchObject({
      provider: "zipu",
      codingAgent: "opencode",
      aiProvider: "zai",
      model: "glm-5.2",
    });
  });
});

afterAll(() => {
  globalThis.fetch = realFetch;
  mock.restore();
  mock.module("../services/discord-thread", () => realDiscordThread);
  mock.module(
    "../../../../shared/ws/ws-connection-manager",
    () => realWsConnectionManager
  );
  restoreRealModules();
});

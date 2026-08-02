import { afterAll, beforeAll, beforeEach, describe, expect, it, mock } from "bun:test";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { eq } from "drizzle-orm";
import { scheduledAgentConfigs } from "../../schema";
import type { NewScheduledAgentConfig } from "../../schema/scheduled-agent-configs";

type ScheduledAgentConfigRepository =
  typeof import("./scheduled-agent-config-repository");

const realClient = { ...(await import("../../client")) };

let client: PGlite;
let database: ReturnType<typeof drizzle>;
let updateScheduledAgentConfigLastRunAt:
  ScheduledAgentConfigRepository["updateScheduledAgentConfigLastRunAt"];
let consumeOnceScheduleOccurrence:
  ScheduledAgentConfigRepository["consumeOnceScheduleOccurrence"];

const workspaceId = "workspace-webhook-token-test";
const existingConfigId = "11111111-1111-4111-8111-111111111111";
const existingWebhookToken = "persisted-webhook-token";

const baseConfig = (
  overrides: Partial<NewScheduledAgentConfig> = {},
): NewScheduledAgentConfig => ({
  id: existingConfigId,
  workspaceId,
  name: "Webhook token test agent",
  jobType: "scheduled",
  provider: "codex",
  codingAgent: "codex",
  trigger: "webhook",
  webhookToken: existingWebhookToken,
  scheduleType: "manual",
  scheduleConfig: null,
  enabled: false,
  targetConfig: {},
  ...overrides,
});

beforeAll(async () => {
  client = new PGlite();
  await client.exec(`
    CREATE TABLE scheduled_agent_configs (
      id uuid PRIMARY KEY,
      workspace_id text NOT NULL,
      owner_user_id text,
      project_id uuid,
      name varchar(255) NOT NULL,
      prompt text,
      job_type text NOT NULL,
      provider text NOT NULL,
      description text,
      coding_agent varchar(100) DEFAULT 'claude-code',
      ai_provider varchar(100),
      ai_model varchar(100),
      reasoning_level varchar(50),
      skill_id uuid,
      trigger text NOT NULL DEFAULT 'scheduled',
      webhook_token varchar(64) UNIQUE,
      schedule_type text NOT NULL,
      schedule_config jsonb,
      timezone varchar(100) NOT NULL DEFAULT 'Europe/Madrid',
      enabled boolean NOT NULL DEFAULT false,
      target_config jsonb NOT NULL DEFAULT '{}',
      mcp_servers jsonb,
      max_jobs_per_run integer NOT NULL DEFAULT 10,
      paused_until timestamptz,
      last_run_at timestamptz,
      managed_by text NOT NULL DEFAULT 'user',
      builtin_automation_id text,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE TABLE scheduled_agent_mcp_servers (
      agent_id uuid NOT NULL,
      mcp_server_id uuid NOT NULL,
      enabled boolean NOT NULL DEFAULT true,
      created_at timestamptz NOT NULL DEFAULT now(),
      PRIMARY KEY (agent_id, mcp_server_id)
    );
  `);
  database = drizzle(client);
  mock.module("../../client", () => ({ db: database }));
  ({
    updateScheduledAgentConfigLastRunAt,
    consumeOnceScheduleOccurrence,
  } = await import("./scheduled-agent-config-repository"));
});

afterAll(async () => {
  mock.module("../../client", () => realClient);
  await client.close();
});

beforeEach(async () => {
  await client.exec("TRUNCATE TABLE scheduled_agent_configs");
});

// ---------------------------------------------------------------------------
// updateScheduledAgentConfigLastRunAt — 'once' auto-disable (issue T2.2)
// ---------------------------------------------------------------------------
//
// updateScheduledAgentConfigLastRunAt is the single choke point every
// dispatch path (all five dispatcher modes, manual/webhook trigger via
// finalizeAgentDispatch) funnels through. These tests exercise the atomic
// `CASE WHEN schedule_type = 'once'` update directly against the row's
// PERSISTED schedule_type — not something the caller passes in — proving
// auto-disable is uniform across every mode without each call site knowing
// about it.
describe("updateScheduledAgentConfigLastRunAt", () => {
  it("auto-disables an enabled 'once' config in the same update as lastRunAt", async () => {
    await database.insert(scheduledAgentConfigs).values(
      baseConfig({
        scheduleType: "once",
        scheduleConfig: { runAt: "2026-08-01T09:00:00.000Z" },
        enabled: true,
      }),
    );

    await updateScheduledAgentConfigLastRunAt(existingConfigId);

    const [persisted] = await database
      .select()
      .from(scheduledAgentConfigs)
      .where(eq(scheduledAgentConfigs.id, existingConfigId));

    expect(persisted?.enabled).toBe(false);
    expect(persisted?.lastRunAt).not.toBeNull();
  });

  it("does not disable a 'cron' config — only 'once' auto-disables", async () => {
    await database.insert(scheduledAgentConfigs).values(
      baseConfig({
        scheduleType: "cron",
        scheduleConfig: { expression: "*/15 * * * *" },
        enabled: true,
      }),
    );

    await updateScheduledAgentConfigLastRunAt(existingConfigId);

    const [persisted] = await database
      .select()
      .from(scheduledAgentConfigs)
      .where(eq(scheduledAgentConfigs.id, existingConfigId));

    expect(persisted?.enabled).toBe(true);
    expect(persisted?.lastRunAt).not.toBeNull();
  });

  it("does not disable a 'time_window' config", async () => {
    await database.insert(scheduledAgentConfigs).values(
      baseConfig({
        scheduleType: "time_window",
        scheduleConfig: { startHour: 9, endHour: 17, daysOfWeek: [] },
        enabled: true,
      }),
    );

    await updateScheduledAgentConfigLastRunAt(existingConfigId);

    const [persisted] = await database
      .select()
      .from(scheduledAgentConfigs)
      .where(eq(scheduledAgentConfigs.id, existingConfigId));

    expect(persisted?.enabled).toBe(true);
  });

  it("is idempotent — calling it twice on an already-disabled 'once' config leaves it disabled", async () => {
    await database.insert(scheduledAgentConfigs).values(
      baseConfig({
        scheduleType: "once",
        scheduleConfig: { runAt: "2026-08-01T09:00:00.000Z" },
        enabled: true,
      }),
    );

    await updateScheduledAgentConfigLastRunAt(existingConfigId);
    await updateScheduledAgentConfigLastRunAt(existingConfigId);

    const [persisted] = await database
      .select()
      .from(scheduledAgentConfigs)
      .where(eq(scheduledAgentConfigs.id, existingConfigId));

    expect(persisted?.enabled).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// consumeOnceScheduleOccurrence — at-most-once PRE-dispatch consumption
// (review Fix 1). Called by dispatchOneConfig BEFORE routing to any mode
// (the 4 deterministic modes + candidateBased), so that a crash or a second
// concurrent replica between the isOnceDue() check and job creation can
// never double-dispatch a 'once' config. This is intentionally scoped to
// schedule_type='once' only — see the WHERE clause below — cron/time_window
// configs must keep being re-evaluated every tick by their reconcilers.
// ---------------------------------------------------------------------------
describe("consumeOnceScheduleOccurrence", () => {
  it("atomically disables an enabled 'once' config and returns true", async () => {
    await database.insert(scheduledAgentConfigs).values(
      baseConfig({
        scheduleType: "once",
        scheduleConfig: { runAt: "2026-08-01T09:00:00.000Z" },
        enabled: true,
      }),
    );

    const consumed = await consumeOnceScheduleOccurrence(existingConfigId);

    expect(consumed).toBe(true);
    const [persisted] = await database
      .select()
      .from(scheduledAgentConfigs)
      .where(eq(scheduledAgentConfigs.id, existingConfigId));
    expect(persisted?.enabled).toBe(false);
    // Deliberately does NOT touch lastRunAt: a crash between this consume
    // and createJob must stay visible as (enabled=false, lastRunAt=null),
    // never silently look like a completed dispatch.
    expect(persisted?.lastRunAt).toBeNull();
  });

  it("returns false and does not re-disable a 'once' config that was already consumed", async () => {
    await database.insert(scheduledAgentConfigs).values(
      baseConfig({
        scheduleType: "once",
        scheduleConfig: { runAt: "2026-08-01T09:00:00.000Z" },
        enabled: false,
      }),
    );

    const consumed = await consumeOnceScheduleOccurrence(existingConfigId);

    expect(consumed).toBe(false);
  });

  it("simulated concurrent consumption: only the first of two racing calls wins", async () => {
    await database.insert(scheduledAgentConfigs).values(
      baseConfig({
        scheduleType: "once",
        scheduleConfig: { runAt: "2026-08-01T09:00:00.000Z" },
        enabled: true,
      }),
    );

    const [first, second] = await Promise.all([
      consumeOnceScheduleOccurrence(existingConfigId),
      consumeOnceScheduleOccurrence(existingConfigId),
    ]);

    // Exactly one of the two concurrent UPDATEs observed enabled=true.
    expect([first, second].filter(Boolean)).toHaveLength(1);
  });

  it("does not disable a 'cron' config, even if enabled", async () => {
    await database.insert(scheduledAgentConfigs).values(
      baseConfig({
        scheduleType: "cron",
        scheduleConfig: { expression: "*/15 * * * *" },
        enabled: true,
      }),
    );

    const consumed = await consumeOnceScheduleOccurrence(existingConfigId);

    expect(consumed).toBe(false);
    const [persisted] = await database
      .select()
      .from(scheduledAgentConfigs)
      .where(eq(scheduledAgentConfigs.id, existingConfigId));
    expect(persisted?.enabled).toBe(true);
  });

  it("returns false for a non-existent config id", async () => {
    const consumed = await consumeOnceScheduleOccurrence("99999999-9999-4999-8999-999999999999");
    expect(consumed).toBe(false);
  });
});

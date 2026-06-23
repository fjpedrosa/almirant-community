import { describe, expect, it } from "bun:test";
import { loadRunnerEnv } from "./config";

// Minimal valid env — only truly required fields
const MINIMAL_ENV: Record<string, string> = {
  ALMIRANT_API_URL: "https://api.almirant.ai",
  ALMIRANT_API_KEY: "crm_k1_testkey12345678",
};

describe("loadRunnerEnv", () => {
  // -----------------------------------------------------------------------
  // Minimal / default values
  // -----------------------------------------------------------------------

  it("loads with minimal required env vars", () => {
    const env = loadRunnerEnv(MINIMAL_ENV);
    expect(env.ALMIRANT_API_URL).toBe("https://api.almirant.ai");
    expect(env.ALMIRANT_API_KEY).toBe("crm_k1_testkey12345678");
  });

  it("generates a WORKER_ID when not provided", () => {
    const env = loadRunnerEnv(MINIMAL_ENV);
    expect(env.WORKER_ID).toBeDefined();
    expect(env.WORKER_ID.length).toBeGreaterThan(0);
  });

  it("uses provided WORKER_ID when present", () => {
    const env = loadRunnerEnv({ ...MINIMAL_ENV, WORKER_ID: "my-worker" });
    expect(env.WORKER_ID).toBe("my-worker");
  });

  it("uses HOSTNAME as fallback for RUNNER_HOSTNAME", () => {
    const env = loadRunnerEnv({ ...MINIMAL_ENV, HOSTNAME: "prod-runner-1" });
    expect(env.RUNNER_HOSTNAME).toBe("prod-runner-1");
  });

  it("uses provided RUNNER_HOSTNAME over HOSTNAME", () => {
    const env = loadRunnerEnv({
      ...MINIMAL_ENV,
      HOSTNAME: "docker-host",
      RUNNER_HOSTNAME: "custom-runner",
    });
    expect(env.RUNNER_HOSTNAME).toBe("custom-runner");
  });

  it("defaults RUNNER_HOSTNAME to 'almirant-runner' when nothing provided", () => {
    const env = loadRunnerEnv(MINIMAL_ENV);
    expect(env.RUNNER_HOSTNAME).toBe("almirant-runner");
  });

  // -----------------------------------------------------------------------
  // Default values for optional fields
  // -----------------------------------------------------------------------

  it("applies correct defaults for numeric fields", () => {
    const env = loadRunnerEnv(MINIMAL_ENV);
    expect(env.PORT).toBe(3002);
    expect(env.MAX_CONCURRENT).toBe(4);
    expect(env.HEARTBEAT_INTERVAL_MS).toBe(10000);
    expect(env.CLAIM_INTERVAL_MS).toBe(10000);
    expect(env.NIGHTLY_CHECK_INTERVAL_MS).toBe(60000);
    expect(env.RUNNER_RAM_BUDGET_ENABLED).toBe("false");
  });

  it("defaults JOB_OVERALL_TIMEOUT_MS to 3 hours", () => {
    const env = loadRunnerEnv(MINIMAL_ENV);
    expect(env.JOB_OVERALL_TIMEOUT_MS).toBe(3 * 60 * 60 * 1000);
  });

  it("defaults EFFORT_POINT_DURATION_MS to 20 minutes", () => {
    const env = loadRunnerEnv(MINIMAL_ENV);
    expect(env.EFFORT_POINT_DURATION_MS).toBe(20 * 60 * 1000);
  });

  it("defaults JOB_PRE_SESSION_TIMEOUT_MS to 5 minutes", () => {
    const env = loadRunnerEnv(MINIMAL_ENV);
    expect(env.JOB_PRE_SESSION_TIMEOUT_MS).toBe(5 * 60 * 1000);
  });

  it("defaults NODE_ENV to development", () => {
    const env = loadRunnerEnv(MINIMAL_ENV);
    expect(env.NODE_ENV).toBe("development");
  });

  it("defaults LOG_LEVEL to info", () => {
    const env = loadRunnerEnv(MINIMAL_ENV);
    expect(env.LOG_LEVEL).toBe("info");
  });

  it("defaults shim images to locally built self-hosted images", () => {
    const env = loadRunnerEnv(MINIMAL_ENV);
    expect(env.OPENCODE_IMAGE).toBe("almirant-opencode-shim:1.14.31");
    expect(env.CLAUDE_SHIM_IMAGE).toBe("almirant-claude-shim:2.1.126");
    expect(env.CODEX_SHIM_IMAGE).toBe("almirant-codex-shim:0.128.0");
  });


  // -----------------------------------------------------------------------
  // Coercion
  // -----------------------------------------------------------------------

  it("coerces string PORT to number", () => {
    const env = loadRunnerEnv({ ...MINIMAL_ENV, PORT: "8080" });
    expect(env.PORT).toBe(8080);
  });

  it("coerces string MAX_CONCURRENT to number", () => {
    const env = loadRunnerEnv({ ...MINIMAL_ENV, MAX_CONCURRENT: "4" });
    expect(env.MAX_CONCURRENT).toBe(4);
  });

  it("coerces JOB_OVERALL_TIMEOUT_MS from string", () => {
    const env = loadRunnerEnv({ ...MINIMAL_ENV, JOB_OVERALL_TIMEOUT_MS: "7200000" });
    expect(env.JOB_OVERALL_TIMEOUT_MS).toBe(7200000);
  });

  it("coerces EFFORT_POINT_DURATION_MS from string", () => {
    const env = loadRunnerEnv({ ...MINIMAL_ENV, EFFORT_POINT_DURATION_MS: "1800000" });
    expect(env.EFFORT_POINT_DURATION_MS).toBe(1800000);
  });

  it("coerces JOB_PRE_SESSION_TIMEOUT_MS from string", () => {
    const env = loadRunnerEnv({ ...MINIMAL_ENV, JOB_PRE_SESSION_TIMEOUT_MS: "600000" });
    expect(env.JOB_PRE_SESSION_TIMEOUT_MS).toBe(600000);
  });

  // -----------------------------------------------------------------------
  // Validation errors
  // -----------------------------------------------------------------------

  it("throws on missing ALMIRANT_API_URL", () => {
    expect(() => loadRunnerEnv({ ALMIRANT_API_KEY: "key" })).toThrow(
      "Invalid runner environment"
    );
  });

  it("throws on missing ALMIRANT_API_KEY", () => {
    expect(() =>
      loadRunnerEnv({ ALMIRANT_API_URL: "https://api.almirant.ai" })
    ).toThrow("Invalid runner environment");
  });

  it("throws on invalid ALMIRANT_API_URL (not a URL)", () => {
    expect(() =>
      loadRunnerEnv({ ...MINIMAL_ENV, ALMIRANT_API_URL: "not-a-url" })
    ).toThrow("Invalid runner environment");
  });

  it("throws on MAX_CONCURRENT > 64", () => {
    expect(() =>
      loadRunnerEnv({ ...MINIMAL_ENV, MAX_CONCURRENT: "100" })
    ).toThrow("Invalid runner environment");
  });

  it("throws on MAX_CONCURRENT < 1", () => {
    expect(() =>
      loadRunnerEnv({ ...MINIMAL_ENV, MAX_CONCURRENT: "0" })
    ).toThrow("Invalid runner environment");
  });

  it("throws on JOB_OVERALL_TIMEOUT_MS below minimum (60000)", () => {
    expect(() =>
      loadRunnerEnv({ ...MINIMAL_ENV, JOB_OVERALL_TIMEOUT_MS: "1000" })
    ).toThrow("Invalid runner environment");
  });

  it("throws on EFFORT_POINT_DURATION_MS below minimum (60000)", () => {
    expect(() =>
      loadRunnerEnv({ ...MINIMAL_ENV, EFFORT_POINT_DURATION_MS: "5000" })
    ).toThrow("Invalid runner environment");
  });

  it("throws on JOB_PRE_SESSION_TIMEOUT_MS below minimum (30000)", () => {
    expect(() =>
      loadRunnerEnv({ ...MINIMAL_ENV, JOB_PRE_SESSION_TIMEOUT_MS: "5000" })
    ).toThrow("Invalid runner environment");
  });

  it("throws on invalid NODE_ENV value", () => {
    expect(() =>
      loadRunnerEnv({ ...MINIMAL_ENV, NODE_ENV: "staging" })
    ).toThrow("Invalid runner environment");
  });

  // -----------------------------------------------------------------------
  // Optional fields
  // -----------------------------------------------------------------------


  it("accepts optional Discord config", () => {
    const env = loadRunnerEnv({
      ...MINIMAL_ENV,
      DISCORD_BOT_TOKEN: "bot-token",
      DISCORD_CHANNEL_ID: "123456",
    });
    expect(env.DISCORD_BOT_TOKEN).toBe("bot-token");
    expect(env.DISCORD_CHANNEL_ID).toBe("123456");
  });

  it("accepts explicit RAM budget opt-in", () => {
    const env = loadRunnerEnv({ ...MINIMAL_ENV, RUNNER_RAM_BUDGET_ENABLED: "true" });
    expect(env.RUNNER_RAM_BUDGET_ENABLED).toBe("true");
  });
});

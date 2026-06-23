import { describe, expect, it } from "bun:test";
import { isPreSessionStartupStuck } from "./agent-job-startup-watchdog";

describe("isPreSessionStartupStuck", () => {
  const now = new Date("2026-05-02T21:00:00.000Z");
  const old = new Date("2026-05-02T20:45:00.000Z");
  const recent = new Date("2026-05-02T20:58:00.000Z");

  it("detecta running + serve.ready antiguo + sin session.created como startup colgado", () => {
    expect(
      isPreSessionStartupStuck(
        {
          status: "running",
          sessionId: null,
          startedAt: old,
          lastServeReadyAt: old,
          hasSessionCreatedLog: false,
        },
        now,
        10 * 60 * 1000,
      ),
    ).toBe(true);
  });

  it("no marca como colgado si ya hay sessionId", () => {
    expect(
      isPreSessionStartupStuck(
        {
          status: "running",
          sessionId: "ses_123",
          startedAt: old,
          lastServeReadyAt: old,
          hasSessionCreatedLog: false,
        },
        now,
        10 * 60 * 1000,
      ),
    ).toBe(false);
  });

  it("no marca como colgado si todavía no venció el timeout", () => {
    expect(
      isPreSessionStartupStuck(
        {
          status: "running",
          sessionId: null,
          startedAt: recent,
          lastServeReadyAt: recent,
          hasSessionCreatedLog: false,
        },
        now,
        10 * 60 * 1000,
      ),
    ).toBe(false);
  });

  it("no marca como colgado si ya existe session.created", () => {
    expect(
      isPreSessionStartupStuck(
        {
          status: "running",
          sessionId: null,
          startedAt: old,
          lastServeReadyAt: old,
          hasSessionCreatedLog: true,
        },
        now,
        10 * 60 * 1000,
      ),
    ).toBe(false);
  });
});

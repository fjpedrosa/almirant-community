import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { isScheduledAgentDispatcherEnabled } from "./background";

// ---------------------------------------------------------------------------
// SCHEDULED_AGENT_DISPATCHER_ENABLED gates startScheduledAgentDispatcher()
// inside startBackgroundJobs(). Running it alongside the runner's own
// scheduler tick DUPLICATES jobs for the deterministic automation modes (see
// the comment on the field in @almirant/config's env.ts) — so both "the
// predicate itself" and "the predicate is actually wired to the dispatcher
// call site" need to stay pinned. As of 2026-08-02 the schema default is
// "true" (backend-authoritative dispatch for fresh installs); an explicit
// "false" is the opt-out existing self-hosters use to keep the runner-only
// path (see RUNNER_SCHEDULER_ENABLED's default-inversion in
// services/runner/src/shared/config.ts).
//
// startBackgroundJobs() is not exercised directly here: it side-effects ~20
// sweepers wired to real timers/DB-backed imports, and mocking all of them
// just to prove one boolean gate would be a large amount of unrelated
// scaffolding for no extra protection. Instead:
//   1. isScheduledAgentDispatcherEnabled is a pure predicate extracted from
//      background.ts, so it is unit-tested directly.
//   2. A source-contract check (the same readFileSync + toContain/match
//      pattern already used by stale-job-recovery-deadline.test.ts in this
//      repo) pins that startScheduledAgentDispatcher's call site is actually
//      guarded by that predicate, so nobody can silently bypass the gate
//      while leaving the predicate itself untouched (and green).
// ---------------------------------------------------------------------------

describe("isScheduledAgentDispatcherEnabled", () => {
  it('is true only for the exact string "true"', () => {
    expect(isScheduledAgentDispatcherEnabled("true")).toBe(true);
  });

  it('is false for "false" — the opt-out existing self-hosters use to keep the runner-only path', () => {
    expect(isScheduledAgentDispatcherEnabled("false")).toBe(false);
  });
});

describe("startBackgroundJobs wiring: scheduled-agent dispatcher stays gated", () => {
  const source = readFileSync(new URL("./background.ts", import.meta.url), "utf8");

  it("starts startScheduledAgentDispatcher only behind isScheduledAgentDispatcherEnabled", () => {
    const gate = source.match(
      /const stopScheduledAgentDispatcher = isScheduledAgentDispatcherEnabled\(\s*env\.SCHEDULED_AGENT_DISPATCHER_ENABLED,?\s*\)\s*\?\s*startScheduledAgentDispatcher\(/,
    );

    expect(gate).not.toBeNull();
  });

  it("calls startScheduledAgentDispatcher exactly once — no rogue second (unconditional) call site", () => {
    const calls = source.match(/startScheduledAgentDispatcher\(/g);

    expect(calls).toHaveLength(1);
  });
});

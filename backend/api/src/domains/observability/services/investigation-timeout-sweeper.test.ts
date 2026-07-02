/**
 * CRÍTICO 1(b) — the investigation-timeout sweeper is the safety net promised by
 * findZombieAttempts' docstring but never wired into community. It periodically
 * fails bug_fix_attempts that are still active (analyzing/proposed/implementing)
 * long after their agent_job died, so a cluster whose cascade was missed still
 * reopens instead of staying stuck forever.
 *
 * These tests inject deps (no DB, no mock.module) so the runner logic is
 * verified in isolation — avoiding the mock.module cross-suite leak gotcha.
 */
import { beforeEach, describe, expect, it } from "bun:test";
import {
  runInvestigationTimeoutOnce,
  type InvestigationTimeoutSweeperDeps,
  type ZombieAttempt,
} from "./investigation-timeout-sweeper";

const silentLogger = { info: () => {}, error: () => {} };

const makeDeps = (
  overrides: Partial<InvestigationTimeoutSweeperDeps> = {}
): InvestigationTimeoutSweeperDeps => ({
  findZombies: async () => [],
  failZombie: async () => true,
  logger: silentLogger,
  ...overrides,
});

describe("runInvestigationTimeoutOnce", () => {
  const state = {
    findArg: null as number | null,
    failed: [] as ZombieAttempt[],
  };

  beforeEach(() => {
    state.findArg = null;
    state.failed = [];
  });

  it("reports zero counters when there are no zombies", async () => {
    const out = await runInvestigationTimeoutOnce(makeDeps(), {
      timeoutMinutes: 30,
    });
    expect(out).toEqual({
      attemptsScanned: 0,
      failed: 0,
      alreadyTerminal: 0,
      errored: 0,
    });
  });

  it("fails each zombie attempt and counts the transitions", async () => {
    const zombies: ZombieAttempt[] = [
      { id: "a1", clusterId: "c1" },
      { id: "a2", clusterId: null },
    ];
    const out = await runInvestigationTimeoutOnce(
      makeDeps({
        findZombies: async () => zombies,
        failZombie: async (z) => {
          state.failed.push(z);
          return true;
        },
      }),
      { timeoutMinutes: 30 }
    );

    expect(state.failed.map((z) => z.id)).toEqual(["a1", "a2"]);
    expect(out).toEqual({
      attemptsScanned: 2,
      failed: 2,
      alreadyTerminal: 0,
      errored: 0,
    });
  });

  it("counts CAS no-ops (attempt already terminal) as alreadyTerminal, not failures", async () => {
    const out = await runInvestigationTimeoutOnce(
      makeDeps({
        findZombies: async () => [{ id: "a1", clusterId: "c1" }],
        failZombie: async () => false, // raced to terminal before we wrote
      }),
      { timeoutMinutes: 30 }
    );
    expect(out).toEqual({
      attemptsScanned: 1,
      failed: 0,
      alreadyTerminal: 1,
      errored: 0,
    });
  });

  it("counts thrown errors and keeps processing the remaining zombies", async () => {
    const out = await runInvestigationTimeoutOnce(
      makeDeps({
        findZombies: async () => [
          { id: "a1", clusterId: "c1" },
          { id: "a2", clusterId: "c2" },
        ],
        failZombie: async (z) => {
          if (z.id === "a1") throw new Error("boom");
          state.failed.push(z);
          return true;
        },
      }),
      { timeoutMinutes: 30 }
    );

    expect(state.failed.map((z) => z.id)).toEqual(["a2"]);
    expect(out).toEqual({
      attemptsScanned: 2,
      failed: 1,
      alreadyTerminal: 0,
      errored: 1,
    });
  });

  it("forwards the configured timeoutMinutes to findZombies", async () => {
    await runInvestigationTimeoutOnce(
      makeDeps({
        findZombies: async (timeoutMinutes) => {
          state.findArg = timeoutMinutes;
          return [];
        },
      }),
      { timeoutMinutes: 7 }
    );
    expect(state.findArg).toBe(7);
  });
});

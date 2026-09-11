import { describe, expect, test } from "bun:test";
import type { Database } from "../../client";
import type {
  LiveAgentJobClaim,
  LiveAgentJobClaimTransaction,
} from "./agent-job-repository";

type Helpers = Pick<typeof import("./agent-job-repository"),
  "withLiveAgentJobClaimWith" | "withLiveAgentJobClaim">;
type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];
type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends
  (<T>() => T extends B ? 1 : 2) ? true : false;
const preciseTransaction: Equal<LiveAgentJobClaimTransaction, Transaction> = true;
const notAny: 0 extends (1 & LiveAgentJobClaimTransaction) ? false : true = true;

// Execute the actual helper without loading the database client or installing
// global module mocks. Only its SQL boundary is replaced, not its control flow.
const source = await Bun.file(new URL("./agent-job-repository.ts", import.meta.url)).text();
const start = source.indexOf("export type LiveAgentJobClaim =");
const end = source.indexOf("export type ClaimReleaseConfig =", start);
if (start < 0 || end <= start) throw new Error("Live-claim helper anchors missing");
const compiled = new Bun.Transpiler({ loader: "ts" }).transformSync(
  source.slice(start, end).replaceAll("export ", ""),
);
const load = new Function("db", "agentJobs", "agentJobClaimSequenceReceipts", "and", "eq", "sql",
  `${compiled}\nreturn { withLiveAgentJobClaimWith, withLiveAgentJobClaim };`,
);

const jobs = {
  id: "job.id", status: "job.status", workspaceId: "job.workspaceId",
  workerId: "job.workerId", config: "job.config",
  resolvedRuntimeSelection: "job.resolvedRuntimeSelection",
};
const receipts = {
  jobId: "receipt.jobId", claimAttemptId: "receipt.claimAttemptId",
  workerId: "receipt.workerId", state: "receipt.state",
};
const ownership = { jobId: "job-1", workerId: "worker-1", claimAttemptId: "attempt-1" };
const config: LiveAgentJobClaim["config"] = {
  repoPath: "/fixture/repository", baseBranch: "main", claimAttemptId: ownership.claimAttemptId,
};
type Row = Record<string, unknown>;
type Predicate = (row: Row) => boolean;
const eq = (column: string, value: unknown): Predicate => (row) =>
  row[column] === (typeof value === "string" && value in row ? row[value] : value);
const and = (...predicates: Predicate[]): Predicate => (row) => predicates.every((p) => p(row));
const sql = (strings: TemplateStringsArray, column: string, value: string): Predicate => {
  expect([...strings]).toEqual(["", " ->> 'claimAttemptId' = ", ""]);
  expect(column).toBe(jobs.config);
  return (row) => (row[column] as { claimAttemptId?: string }).claimAttemptId === value;
};

function harness(selection: LiveAgentJobClaim["resolvedRuntimeSelection"] = null) {
  const events: string[] = [];
  const row: Row = {
    [jobs.id]: ownership.jobId, [jobs.status]: "running", [jobs.workspaceId]: "workspace-1",
    [jobs.workerId]: ownership.workerId, [jobs.config]: config,
    [jobs.resolvedRuntimeSelection]: selection,
    [receipts.jobId]: ownership.jobId, [receipts.claimAttemptId]: ownership.claimAttemptId,
    [receipts.workerId]: ownership.workerId, [receipts.state]: "active",
  };
  let active = false;
  let selects = 0;
  let present = true;
  const tx = {
    select(fields: Record<string, string>) {
      expect(active).toBe(true);
      const first = ++selects === 1;
      expect(selects).toBeLessThanOrEqual(2);
      if (first) {
        expect(fields).toEqual(jobs);
      } else {
        expect(fields).toEqual({ id: jobs.id });
      }
      events.push(first ? "select:locked" : "select:recheck");
      return {
        from(table: unknown) {
          expect(table).toBe(receipts);
          return {
            innerJoin(table: unknown, join: Predicate) {
              expect(table).toBe(jobs);
              return {
                where(predicate: Predicate) {
                  const limit = async (count: number) => {
                    expect(count).toBe(1);
                    expect(active).toBe(true);
                    events.push(first ? "read:locked" : "read:recheck");
                    if (!present || !join(row) || !predicate(row)) return [];
                    return [Object.fromEntries(Object.entries(fields).map(([key, column]) => [key, row[column]]))];
                  };
                  // The first query cannot execute without FOR UPDATE; the
                  // authorization recheck cannot accidentally acquire it first.
                  return first ? {
                    for(mode: string) {
                      expect(mode).toBe("update");
                      events.push("lock:update");
                      return { limit };
                    },
                  } : { limit };
                },
              };
            },
          };
        },
      };
    },
  };
  const database = {
    async transaction<T>(callback: (transaction: typeof tx) => Promise<T>): Promise<T> {
      expect(active).toBe(false);
      active = true;
      events.push("begin");
      try {
        const result = await callback(tx);
        events.push("commit");
        return result;
      } catch (error) {
        events.push("rollback");
        throw error;
      } finally {
        active = false;
      }
    },
  };
  const helpers = load(database, jobs, receipts, and, eq, sql) as Helpers;
  return {
    ...helpers, row, tx, events,
    // The only structural cast: the fake deliberately implements no unrelated
    // Drizzle methods, so unexpected query-builder use fails immediately.
    database: database as unknown as Pick<Database, "transaction">,
    remove: () => { present = false; },
    operation: () => {
      expect(active).toBe(true);
      expect(events.at(-1)).toBe("read:locked");
      events.push("operation");
    },
  };
}

const completedEvents = [
  "begin", "select:locked", "lock:update", "read:locked", "operation",
  "select:recheck", "read:recheck", "commit",
];

const staleRows: [string, unknown][] = [
  [jobs.id, "other-job"], [receipts.jobId, "other-job"],
  [jobs.workerId, "other-worker"], [jobs.workerId, null],
  [receipts.workerId, "other-worker"], [receipts.claimAttemptId, "old-attempt"],
  [jobs.config, { claimAttemptId: "old-attempt" }], [jobs.config, {}],
  [jobs.config, { claimAttemptId: ` ${ownership.claimAttemptId} ` }],
  ...["queued", "finalizing", "completed", "incomplete", "failed", "cancelled", "waiting_for_input", "paused"]
    .map((status): [string, unknown] => [jobs.status, status]),
  ...["draining", "ready", "released", "terminal"]
    .map((state): [string, unknown] => [receipts.state, state]),
];

describe("live claim transaction", () => {
  test("exports the precise database callback transaction type", () => {
    expect(preciseTransaction).toBe(true);
    expect(notAny).toBe(true);
  });

  for (const wrapper of [false, true]) {
    test(`forwards the exact transaction and returns only after recheck (wrapper=${wrapper})`, async () => {
      const h = harness();
      const result = { authorized: true };
      const operation = async (job: LiveAgentJobClaim, transaction: LiveAgentJobClaimTransaction) => {
        h.operation();
        expect<unknown>(transaction).toBe(h.tx);
        expect(job).toEqual({
          id: ownership.jobId, status: "running", workspaceId: "workspace-1",
          workerId: ownership.workerId, config,
          resolvedRuntimeSelection: null,
        });
        await Promise.resolve();
        expect(h.events.at(-1)).toBe("operation");
        return result;
      };
      const value = wrapper
        ? await h.withLiveAgentJobClaim(ownership, operation)
        : await h.withLiveAgentJobClaimWith(h.database, ownership, operation);
      expect(value).toBe(result);
      expect(h.events).toEqual(completedEvents);
    });
  }

  test("projects the persisted runtime selection unchanged, without resolving it again", async () => {
    const selection: NonNullable<LiveAgentJobClaim["resolvedRuntimeSelection"]> = {
      schemaVersion: "resolved-runtime-selection-v1", registryVersion: 1,
      projectionHash: "persisted-projection", provider: "codex", codingAgent: "pi",
      aiProvider: "openai", model: "persisted-model", authClass: "subscription", capabilities: [],
      provenance: {
        provider: "explicit", codingAgent: "explicit", aiProvider: "explicit",
        model: "explicit", authClass: "explicit", capabilities: "explicit",
      },
    };
    const h = harness(selection);
    const value = await h.withLiveAgentJobClaimWith(h.database, ownership, async (job, tx) => {
      h.operation();
      expect<unknown>(tx).toBe(h.tx);
      expect(job.resolvedRuntimeSelection).toBe(selection);
      return job.resolvedRuntimeSelection;
    });
    expect(value).toBe(selection);
    expect(h.events).toEqual(completedEvents);
  });

  for (const key of ["jobId", "workerId", "claimAttemptId"] as const) {
    for (const value of ["", " \t\n"]) {
      test(`rejects blank ${key}=${JSON.stringify(value)} before opening a transaction`, async () => {
        const h = harness();
        const result = await h.withLiveAgentJobClaimWith(h.database, { ...ownership, [key]: value }, async () => {
          throw new Error("Operation must not run");
        });
        expect(result).toBeNull();
        expect(h.events).toEqual([]);
      });
    }
  }

  for (const [column, value] of staleRows) {
    test(`rejects stale ${column}=${JSON.stringify(value)} before operation`, async () => {
      const h = harness();
      h.row[column] = value;
      expect(await h.withLiveAgentJobClaimWith(h.database, ownership, async () => {
        throw new Error("Operation must not run");
      })).toBeNull();
      expect(h.events).toEqual(["begin", "select:locked", "lock:update", "read:locked", "commit"]);
    });

    test(`discards operation result when recheck loses ${column}=${JSON.stringify(value)}`, async () => {
      const h = harness();
      expect(await h.withLiveAgentJobClaimWith(h.database, ownership, async () => {
        h.operation();
        h.row[column] = value;
        return { mustNotEscape: true };
      })).toBeNull();
      expect(h.events).toEqual(completedEvents);
    });
  }

  test("never invokes the operation when no claim row exists", async () => {
    const h = harness();
    h.remove();
    expect(await h.withLiveAgentJobClaimWith(h.database, ownership, async () => {
      throw new Error("Operation must not run");
    })).toBeNull();
    expect(h.events).toEqual(["begin", "select:locked", "lock:update", "read:locked", "commit"]);
  });

  test("discards the result when the recheck finds no row", async () => {
    const h = harness();
    expect(await h.withLiveAgentJobClaimWith(h.database, ownership, async () => {
      h.operation();
      h.remove();
      return "discarded";
    })).toBeNull();
    expect(h.events).toEqual(completedEvents);
  });

  for (const wrapper of [false, true]) {
    test(`preserves trimming and one-argument callbacks (wrapper=${wrapper})`, async () => {
      const h = harness();
      const padded = {
        jobId: ` ${ownership.jobId}\n`, workerId: `\t${ownership.workerId} `,
        claimAttemptId: ` ${ownership.claimAttemptId} `,
      };
      const operation = async (job: LiveAgentJobClaim) => {
        h.operation();
        expect(job.workerId).toBe(ownership.workerId);
        return job.id;
      };
      expect(wrapper
        ? await h.withLiveAgentJobClaim(padded, operation)
        : await h.withLiveAgentJobClaimWith(h.database, padded, operation)).toBe(ownership.jobId);
      expect(h.events).toEqual(completedEvents);
    });

    test(`preserves the original operation rejection without rechecking (wrapper=${wrapper})`, async () => {
      const h = harness();
      const failure = new Error("operation failed");
      const operation = async () => {
        h.operation();
        await Promise.resolve();
        throw failure;
      };
      await expect(wrapper
        ? h.withLiveAgentJobClaim(ownership, operation)
        : h.withLiveAgentJobClaimWith(h.database, ownership, operation)).rejects.toBe(failure);
      expect(h.events).toEqual([
        "begin", "select:locked", "lock:update", "read:locked", "operation", "rollback",
      ]);
    });
  }
});

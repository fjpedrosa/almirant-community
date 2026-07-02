import { afterAll, beforeEach, describe, expect, it, mock } from "bun:test";

// Preserve the real sibling modules BEFORE the `mock.module` calls below
// activate. Without this, bun's global mock registry would leak our stubs
// into any test file that runs after this one and imports these modules.
import * as realEffortEstimatorModule from "./effort-estimator";
const realEffortEstimator = { ...realEffortEstimatorModule };
import * as realPosthogModule from "../../../shared/services/posthog-service";
const realPosthog = { ...realPosthogModule };
import { restoreRealModules } from "../../../test/mocks";

// ---------------------------------------------------------------------------
// Shared mock state
// ---------------------------------------------------------------------------

type ClaimedRow = {
  id: string;
  workItemId: string;
  attemptCount: number;
};

type WorkItemRow = {
  id: string;
  title: string;
  description: string | null;
  type: string;
  parentId: string | null;
  projectId: string | null;
  workspaceId: string | null;
};

type RequestRow = {
  id: string;
  workItemId: string;
  status: "pending" | "processing" | "done" | "failed";
  attemptCount: number;
  errorMessage: string | null;
};

const state = {
  // Rows the next `claimBatch` call will return (already transitioned to
  // 'processing' with attempt_count bumped by one). Subsequent calls return
  // whatever remains in `pendingRows`.
  pendingRows: [] as ClaimedRow[],
  requests: new Map<string, RequestRow>(),
  workItems: new Map<string, WorkItemRow>(),
  featureFlag: true,
  runEffortEstimationBehavior: "ok" as "ok" | "throw",
  runEffortEstimationCalls: [] as string[],
  updateCalls: [] as { id: string; patch: Record<string, unknown> }[],
};

const resetState = () => {
  state.pendingRows = [];
  state.requests = new Map();
  state.workItems = new Map();
  state.featureFlag = true;
  state.runEffortEstimationBehavior = "ok";
  state.runEffortEstimationCalls = [];
  state.updateCalls = [];
};

// ---------------------------------------------------------------------------
// Module mocks
// ---------------------------------------------------------------------------

mock.module("@almirant/config", () => ({
  logger: {
    info: () => {},
    warn: () => {},
    error: () => {},
    debug: () => {},
  },
}));

mock.module("@almirant/database", () => {
  // Minimal in-memory stand-ins for the Drizzle primitives the sweeper uses.
  // We only need to satisfy the shape the sweeper reads back; query builders
  // return a thenable that resolves to a predetermined result shape.

  const getRequest = (id: string) => state.requests.get(id);

  const updateRequestPatch = (
    id: string,
    patch: Partial<RequestRow> & { updated_at?: unknown },
  ) => {
    const current = getRequest(id);
    if (!current) return;
    state.requests.set(id, { ...current, ...patch });
  };

  // Declared via type alias so it can self-reference in transaction's arg.
  type FakeDb = Record<string, unknown>;
  const db: FakeDb = {
    transaction: async (fn: (tx: FakeDb) => Promise<unknown>) => fn(db),
    // `db.execute(sql`…`)` — used by claimBatch. We ignore the SQL template
    // entirely and just hand back the rows the test staged on state.pendingRows.
    execute: async (_sqlTemplate: unknown) => {
      const rows = state.pendingRows;
      // Simulate the UPDATE → 'processing' side-effect for the rows we hand back.
      for (const row of rows) {
        updateRequestPatch(row.id, {
          status: "processing",
          attemptCount: row.attemptCount,
        });
      }
      return rows as unknown as Record<string, unknown>[];
    },
    // `db.update(table).set(patch).where(cond)` — the sweeper uses this to
    // transition requests. We capture the patch via a tiny fluent builder.
    update: (_table: unknown) => ({
      set: (patch: Record<string, unknown>) => ({
        where: async (cond: { __reqId?: string }) => {
          const id = cond.__reqId;
          if (!id) return [];
          state.updateCalls.push({ id, patch });
          updateRequestPatch(id, {
            status: (patch.status as RequestRow["status"]) ?? undefined,
            errorMessage: (patch.errorMessage as string | null) ?? null,
          });
          return [];
        },
      }),
    }),
    // `db.select(fields).from(table).leftJoin(...).where(...).limit(...)` and
    // `db.select(fields).from(table).where(...)` — used by loadRunParams to
    // read the work item and its children. The sweeper calls them in a
    // predictable order: first the join form for the item itself, then the
    // children query. We return both shapes based on the last `where`.
    select: (_fields: unknown) => {
      return {
        from: (_table: unknown) => ({
          leftJoin: (_j1: unknown, _j2: unknown) => ({
            where: (cond: { __workItemId?: string }) => ({
              limit: async (_n: number) => {
                const wi = cond.__workItemId
                  ? state.workItems.get(cond.__workItemId)
                  : undefined;
                if (!wi) return [];
                return [
                  {
                    id: wi.id,
                    title: wi.title,
                    description: wi.description,
                    type: wi.type,
                    parentId: wi.parentId,
                    workspaceId: wi.workspaceId,
                  },
                ];
              },
            }),
          }),
          where: async (_cond: { __parentId?: string }) => {
            // Children lookup — always empty for the simple tests.
            return [];
          },
        }),
      };
    },
  };

  // Helpers to let the sweeper's `eq(col, value)` produce a cond object our
  // fake `where` handlers can route on.
  const eq = (col: { __col?: string }, value: unknown) => {
    if (col?.__col === "work_items.id") return { __workItemId: value };
    if (col?.__col === "work_items.parent_id") return { __parentId: value };
    if (col?.__col === "projects.id") return { __join: value };
    if (col?.__col === "effort_estimation_requests.id") return { __reqId: value };
    return {};
  };

  const sql = (_strings: TemplateStringsArray, ..._values: unknown[]) => ({
    __sql: true,
  });

  // Column markers so eq() can route cond objects to the correct `where` branch.
  const workItems = {
    id: { __col: "work_items.id" },
    parentId: { __col: "work_items.parent_id" },
    projectId: { __col: "work_items.project_id" },
    title: { __col: "work_items.title" },
    description: { __col: "work_items.description" },
    type: { __col: "work_items.type" },
  };
  const projects = {
    id: { __col: "projects.id" },
    workspaceId: { __col: "projects.workspace_id" },
  };
  const effortEstimationRequests = {
    id: { __col: "effort_estimation_requests.id" },
  };

  return {
    db,
    eq,
    sql,
    workItems,
    projects,
    effortEstimationRequests,
    computeWorkItemContentHash: (_input: unknown) => "hash-stub",
    // `getCachedActiveConfig` is read by loadRunParams once per row.
    getCachedActiveConfig: async () => ({
      provider: "openai" as const,
      model: "gpt-4o-mini",
      temperature: "0",
      maxTokens: 1024,
      systemPrompt: "estimate effort",
    }),
  };
});

mock.module("../../../shared/services/posthog-service", () => ({
  isFeatureFlagEnabled: async (_flagKey: string, _distinctId: string) =>
    state.featureFlag,
}));

mock.module("./effort-estimator", () => ({
  runEffortEstimation: async (params: { workItem: { id: string } }) => {
    state.runEffortEstimationCalls.push(params.workItem.id);
    if (state.runEffortEstimationBehavior === "throw") {
      throw new Error("llm-boom");
    }
    return {
      result: {
        estimatedSubagents: 3,
        estimatedMemoryMb: 2048,
        confidence: "medium" as const,
        reasoning: "ok",
      },
      tokensUsed: 0,
      latencyMs: 1,
      contentHash: "hash-stub",
      source: "llm" as const,
    };
  },
  // The sweeper imports getCachedActiveConfig from effort-estimator directly,
  // so we must stub it on this module (not on @almirant/database).
  getCachedActiveConfig: async () => ({
    provider: "openai" as const,
    model: "gpt-4o-mini",
    temperature: "0",
    maxTokens: 1024,
    systemPrompt: "estimate effort",
  }),
  invalidateConfigCache: () => {},
}));

// ---------------------------------------------------------------------------
// Fixture helpers
// ---------------------------------------------------------------------------

const stageRequest = (args: {
  id: string;
  workItemId: string;
  attemptCount: number;
}) => {
  state.requests.set(args.id, {
    id: args.id,
    workItemId: args.workItemId,
    status: "pending",
    attemptCount: args.attemptCount,
    errorMessage: null,
  });
  // After claimBatch: row is in 'processing' with attempt_count + 1.
  state.pendingRows.push({
    id: args.id,
    workItemId: args.workItemId,
    attemptCount: args.attemptCount + 1,
  });
};

const stageWorkItem = (args: {
  id: string;
  workspaceId?: string | null;
  type?: string;
}) => {
  state.workItems.set(args.id, {
    id: args.id,
    title: "t",
    description: null,
    type: args.type ?? "task",
    parentId: null,
    projectId: "proj-1",
    workspaceId: args.workspaceId ?? "org-1",
  });
};

// ---------------------------------------------------------------------------
// Tests — gated on DATABASE_URL per A-1943 spec. The mocks don't touch a real
// DB, but the spec asks us to keep these behind the same gate that all other
// DB-adjacent tests use so CI environments without the infrastructure skip
// them uniformly.
// ---------------------------------------------------------------------------

const HAS_DB_URL = Boolean(process.env.DATABASE_URL);

describe.skipIf(!HAS_DB_URL)(
  "effort-estimation-sweeper::runEffortEstimationSweeperOnce",
  () => {
    beforeEach(() => {
      resetState();
    });

    it("transitions pending → done when the LLM call succeeds", async () => {
      stageRequest({ id: "req-1", workItemId: "wi-1", attemptCount: 0 });
      stageWorkItem({ id: "wi-1" });

      const { runEffortEstimationSweeperOnce } = await import(
        "./effort-estimation-sweeper"
      );

      const out = await runEffortEstimationSweeperOnce({ batchSize: 5 });

      expect(out).toEqual({ processed: 1, failed: 0 });
      expect(state.runEffortEstimationCalls).toEqual(["wi-1"]);
      expect(state.requests.get("req-1")?.status).toBe("done");
    });

    it("marks failed after MAX_ATTEMPTS when runEffortEstimation keeps throwing", async () => {
      // attempt_count in DB is 2. claimBatch bumps it to 3, which is
      // >= MAX_ATTEMPTS (3), so the failure path must be terminal.
      stageRequest({ id: "req-2", workItemId: "wi-2", attemptCount: 2 });
      stageWorkItem({ id: "wi-2" });
      state.runEffortEstimationBehavior = "throw";

      const { runEffortEstimationSweeperOnce } = await import(
        "./effort-estimation-sweeper"
      );

      const out = await runEffortEstimationSweeperOnce({ batchSize: 5 });

      expect(out).toEqual({ processed: 0, failed: 1 });
      const row = state.requests.get("req-2");
      expect(row?.status).toBe("failed");
      expect(row?.errorMessage).toContain("llm-boom");
    });

    it("requeues as pending on transient failure when under MAX_ATTEMPTS", async () => {
      // attempt_count in DB is 0. claimBatch bumps it to 1, still below 3.
      stageRequest({ id: "req-3", workItemId: "wi-3", attemptCount: 0 });
      stageWorkItem({ id: "wi-3" });
      state.runEffortEstimationBehavior = "throw";

      const { runEffortEstimationSweeperOnce } = await import(
        "./effort-estimation-sweeper"
      );

      const out = await runEffortEstimationSweeperOnce({ batchSize: 5 });

      expect(out).toEqual({ processed: 0, failed: 1 });
      const row = state.requests.get("req-3");
      expect(row?.status).toBe("pending");
      expect(row?.errorMessage).toContain("llm-boom");
    });

    it("marks failed without calling the LLM when the feature flag is OFF", async () => {
      stageRequest({ id: "req-4", workItemId: "wi-4", attemptCount: 0 });
      stageWorkItem({ id: "wi-4" });
      state.featureFlag = false;

      const { runEffortEstimationSweeperOnce } = await import(
        "./effort-estimation-sweeper"
      );

      const out = await runEffortEstimationSweeperOnce({ batchSize: 5 });

      expect(out).toEqual({ processed: 0, failed: 1 });
      expect(state.runEffortEstimationCalls).toEqual([]);
      const row = state.requests.get("req-4");
      expect(row?.status).toBe("failed");
      expect(row?.errorMessage).toBe("feature flag disabled");
    });

    it("processes multiple rows sequentially (no Promise.all)", async () => {
      stageRequest({ id: "req-a", workItemId: "wi-a", attemptCount: 0 });
      stageRequest({ id: "req-b", workItemId: "wi-b", attemptCount: 0 });
      stageWorkItem({ id: "wi-a" });
      stageWorkItem({ id: "wi-b" });

      const { runEffortEstimationSweeperOnce } = await import(
        "./effort-estimation-sweeper"
      );

      const out = await runEffortEstimationSweeperOnce({ batchSize: 5 });

      expect(out).toEqual({ processed: 2, failed: 0 });
      // Sequential processing preserves the order claimBatch returned them in.
      expect(state.runEffortEstimationCalls).toEqual(["wi-a", "wi-b"]);
    });
  },
);

afterAll(() => {
  mock.restore();
  // mock.restore() clears spies but NOT mock.module() registrations. Re-install
  // the real modules so sibling tests that import them after us see the
  // originals rather than our stubs.
  restoreRealModules();
  mock.module("./effort-estimator", () => realEffortEstimator);
  mock.module("../../../shared/services/posthog-service", () => realPosthog);
});

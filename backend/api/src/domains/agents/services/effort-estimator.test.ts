import { afterAll, beforeEach, describe, expect, it, mock } from "bun:test";
import { z } from "zod";

// Capture the real local modules BEFORE any `mock.module(...)` call below.
// `mock.restore()` does NOT unregister `mock.module` stubs in Bun, so without
// this snapshot the stubs defined here would leak to any sibling test file
// that runs later in the same `bun test` process (see
// memory: feedback_bun_mock_module_leak.md).
import * as realStructuredOutput from "../../ai/shared/services/structured-output";
import * as realModelFactory from "../../ai/shared/services/model-factory";
import { restoreRealModules } from "../../../test/mocks";

const __realStructuredOutput = { ...realStructuredOutput };
const __realModelFactory = { ...realModelFactory };

// ---------------------------------------------------------------------------
// Mock state — shared across tests, reset in beforeEach
// ---------------------------------------------------------------------------

type UpsertCall = {
  workItemId: string;
  estimatedSubagents: number;
  estimatedMemoryMb: number;
  confidence: "low" | "medium" | "high";
  reasoning: string;
  contentHash: string;
  source: "llm" | "fallback_heuristic";
};

type GenerateScenario =
  | {
      kind: "ok";
      result: {
        estimatedSubagents: number;
        estimatedMemoryMb: number;
        confidence: "low" | "medium" | "high";
        reasoning: string;
      };
      tokensUsed?: number;
    }
  | { kind: "throw"; error: Error }
  | { kind: "zod_exhausted" };

const state = {
  upsertCalls: [] as UpsertCall[],
  generateScenario: {
    kind: "ok",
    result: {
      estimatedSubagents: 3,
      estimatedMemoryMb: 2048,
      confidence: "medium" as const,
      reasoning: "llm-ok",
    },
    tokensUsed: 111,
  } as GenerateScenario,
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

mock.module("@almirant/database", () => ({
  // Hashing — use a stable stub to keep assertions predictable.
  computeWorkItemContentHash: (input: {
    title: string;
    childIds?: string[];
  }) =>
    `hash:${input.title}:${(input.childIds ?? []).slice().sort().join(",")}`,
  getActiveConfig: async () => null, // service receives `config` directly
  upsertEstimate: async (data: UpsertCall) => {
    state.upsertCalls.push(data);
    return { id: "row-1", ...data, stale: false };
  },
}));

// Mock the LLM helper: the estimator imports it from the ai shared module.
mock.module(
  "../../ai/shared/services/structured-output",
  () => ({
    generateStructuredJson: async (_params: unknown) => {
      const s = state.generateScenario;
      if (s.kind === "throw") throw s.error;
      if (s.kind === "zod_exhausted") {
        throw new Error(
          "Failed to generate valid structured JSON after 3 attempts",
        );
      }
      return {
        result: s.result,
        tokensUsed: s.tokensUsed ?? 0,
        latencyMs: 5,
      };
    },
  }),
);

// Mock the model factory: we don't want real LangChain model instantiation
// during tests, but the estimator still needs `resolveModelByPolicy` /
// `getDefaultModel` to return *something* so it can be passed through.
mock.module(
  "../../ai/shared/services/model-factory",
  () => ({
    createModel: () => ({}) as unknown,
    getDefaultModel: () => ({}) as unknown,
    resolveModelByPolicy: async () => null,
    withAuthErrorDetection: async (
      _connectionId: string,
      fn: () => Promise<unknown>,
    ) => fn(),
  }),
);

// ---------------------------------------------------------------------------
// Fixture builder
// ---------------------------------------------------------------------------

type RunParams = {
  dryRun?: boolean;
  children?: Array<{ id: string; title: string; type: string }>;
};

const buildParams = (overrides: RunParams = {}) => ({
  workItem: {
    id: "wi-1",
    title: "Build payments feature",
    description: "Add Stripe integration and webhook handler",
    type: "epic",
    parentId: null as string | null,
    workspaceId: null as string | null,
  },
  children: overrides.children ?? [
    { id: "c1", title: "Create checkout session", type: "task" },
    { id: "c2", title: "Handle webhook", type: "task" },
  ],
  config: {
    provider: "openai" as const,
    model: "gpt-4o-mini",
    temperature: 0,
    maxTokens: 1024,
    systemPrompt: "You estimate effort.",
  },
  userId: undefined as string | undefined,
  dryRun: overrides.dryRun,
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("effort-estimator::runEffortEstimation", () => {
  beforeEach(() => {
    state.upsertCalls = [];
    state.generateScenario = {
      kind: "ok",
      result: {
        estimatedSubagents: 3,
        estimatedMemoryMb: 2048,
        confidence: "medium",
        reasoning: "llm-ok",
      },
      tokensUsed: 111,
    };
  });

  it("dry run: returns the LLM result without writing to the DB", async () => {
    const { runEffortEstimation } = await import("./effort-estimator");

    const out = await runEffortEstimation(buildParams({ dryRun: true }));

    expect(out.source).toBe("llm");
    expect(out.result).toEqual({
      estimatedSubagents: 3,
      estimatedMemoryMb: 2048,
      confidence: "medium",
      reasoning: "llm-ok",
    });
    expect(out.tokensUsed).toBe(111);
    expect(out.contentHash).toMatch(/^hash:Build payments feature:/);
    expect(state.upsertCalls).toEqual([]);
  });

  it("persist path: upsertEstimate is called once with source='llm'", async () => {
    const { runEffortEstimation } = await import("./effort-estimator");

    const out = await runEffortEstimation(buildParams());

    expect(out.source).toBe("llm");
    expect(state.upsertCalls).toHaveLength(1);
    const [call] = state.upsertCalls;
    expect(call).toMatchObject({
      workItemId: "wi-1",
      estimatedSubagents: 3,
      estimatedMemoryMb: 2048,
      confidence: "medium",
      reasoning: "llm-ok",
      source: "llm",
    });
    expect(call?.contentHash).toBe(out.contentHash);
  });

  it("LLM throws: returns fallback heuristic with source='fallback_heuristic' and persists it", async () => {
    state.generateScenario = {
      kind: "throw",
      error: new Error("boom: provider unreachable"),
    };

    const { runEffortEstimation } = await import("./effort-estimator");

    const out = await runEffortEstimation(buildParams());

    expect(out.source).toBe("fallback_heuristic");
    // 2 children → min(1, min(4, 2)) = 2 subagents, mem = min(4,2)*500+1024 = 2024
    expect(out.result).toEqual({
      estimatedSubagents: 2,
      estimatedMemoryMb: 2024,
      confidence: "low",
      reasoning: "LLM failed 3 times — fallback heuristic applied",
    });
    expect(out.tokensUsed).toBe(0);
    expect(state.upsertCalls).toHaveLength(1);
    expect(state.upsertCalls[0]?.source).toBe("fallback_heuristic");
  });

  it("helper exhausts retries (ZodError bubbled as a generic error): fallback is applied", async () => {
    state.generateScenario = { kind: "zod_exhausted" };

    const { runEffortEstimation } = await import("./effort-estimator");

    const out = await runEffortEstimation(buildParams());

    expect(out.source).toBe("fallback_heuristic");
    expect(out.result.confidence).toBe("low");
    expect(out.result.reasoning).toBe(
      "LLM failed 3 times — fallback heuristic applied",
    );
    expect(state.upsertCalls).toHaveLength(1);
    expect(state.upsertCalls[0]?.source).toBe("fallback_heuristic");
  });

  it("dry run + LLM failure: fallback result returned, nothing persisted", async () => {
    state.generateScenario = {
      kind: "throw",
      error: new Error("timeout"),
    };

    const { runEffortEstimation } = await import("./effort-estimator");

    const out = await runEffortEstimation(buildParams({ dryRun: true }));

    expect(out.source).toBe("fallback_heuristic");
    expect(state.upsertCalls).toEqual([]);
  });

  it("fallback heuristic handles zero children: minimum 1 subagent, 1524 MB", async () => {
    state.generateScenario = {
      kind: "throw",
      error: new Error("nope"),
    };

    const { runEffortEstimation } = await import("./effort-estimator");

    const out = await runEffortEstimation(buildParams({ children: [] }));

    expect(out.result).toEqual({
      estimatedSubagents: 1,
      estimatedMemoryMb: 1524, // min(4, 1) * 500 + 1024
      confidence: "low",
      reasoning: "LLM failed 3 times — fallback heuristic applied",
    });
  });
});

// ---------------------------------------------------------------------------
// Static schema smoke test — guarantees the schema stays in sync with the
// public result contract (no drift between task spec and implementation).
// ---------------------------------------------------------------------------

describe("effort-estimator::resultSchema", () => {
  it("accepts a valid payload and rejects out-of-range subagents", async () => {
    const { __internals } = await import("./effort-estimator");
    const ok = __internals.resultSchema.safeParse({
      estimatedSubagents: 5,
      estimatedMemoryMb: 4096,
      confidence: "high",
      reasoning: "ok",
    });
    expect(ok.success).toBe(true);

    const bad = __internals.resultSchema.safeParse({
      estimatedSubagents: 99,
      estimatedMemoryMb: 4096,
      confidence: "high",
      reasoning: "ok",
    });
    expect(bad.success).toBe(false);
    if (!bad.success) {
      // Confirm Zod sees the max constraint
      expect(bad.error).toBeInstanceOf(z.ZodError);
    }
  });
});

afterAll(() => {
  mock.restore();
  // Re-register the real implementations so this file's mock.module stubs
  // don't bleed into sibling test files (Bun limitation).
  restoreRealModules();
  mock.module(
    "../../ai/shared/services/structured-output",
    () => __realStructuredOutput,
  );
  mock.module(
    "../../ai/shared/services/model-factory",
    () => __realModelFactory,
  );
});

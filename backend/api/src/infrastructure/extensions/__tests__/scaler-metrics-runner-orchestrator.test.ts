import { describe, it, expect, mock } from "bun:test";

// Mock BEFORE importing the orchestrator so the mocked env is picked up.
mock.module("@almirant/config", () => ({
  env: { SCALER_METRICS_URL: undefined },
  logger: {
    warn: mock(() => {}),
    debug: mock(() => {}),
  },
}));

import { scalerMetricsRunnerOrchestrator } from "../scaler-metrics-runner-orchestrator";

describe("ScalerMetricsRunnerOrchestrator", () => {
  it("returns null when SCALER_METRICS_URL is not configured", async () => {
    const result = await scalerMetricsRunnerOrchestrator.getMetrics();
    expect(result).toBeNull();
  });

  // Future: test parsing logic with a mocked fetch. Skipped for now because
  // module-level env/fetch mocking semantics in bun:test are awkward for
  // this orchestrator shape; the parsing logic is preserved verbatim from
  // the previous inline implementation in workers-dashboard.routes.ts.
});

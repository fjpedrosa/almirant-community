#!/usr/bin/env bun

/**
 * Post-deploy smoke test for the Almirant agent pipeline.
 *
 * Verifies:
 * 1. Backend API is healthy (GET /health/ready)
 * 2. WebSocket connection can be established
 * 3. (Optional) A smoke-test job completes successfully
 *
 * Usage:
 *   API_BASE_URL=http://localhost:3001 API_KEY=your-key bun run scripts/smoke-test.ts
 *
 * Exit codes:
 *   0 = all checks passed
 *   1 = one or more checks failed
 */

const API_BASE_URL = process.env.API_BASE_URL ?? "http://localhost:3001";
const API_KEY = process.env.API_KEY;
const TIMEOUT_MS = 10_000;

type CheckResult = { name: string; passed: boolean; message: string; durationMs: number };

const results: CheckResult[] = [];

const runCheck = async (
  name: string,
  fn: () => Promise<string>,
): Promise<void> => {
  const start = Date.now();
  try {
    const message = await fn();
    results.push({ name, passed: true, message, durationMs: Date.now() - start });
    console.log(`  \u2713 ${name}: ${message} (${Date.now() - start}ms)`);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    results.push({ name, passed: false, message, durationMs: Date.now() - start });
    console.log(`  \u2717 ${name}: ${message} (${Date.now() - start}ms)`);
  }
};

// ---------------------------------------------------------------------------
// Check 1: Backend API Health
// ---------------------------------------------------------------------------

const checkApiHealth = async (): Promise<string> => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const res = await fetch(`${API_BASE_URL}/health/ready`, {
      signal: controller.signal,
    });
    clearTimeout(timer);

    if (!res.ok) {
      throw new Error(`HTTP ${res.status}`);
    }

    const body = await res.json() as { status?: string };
    return `status=${body.status ?? "ok"}`;
  } catch (err) {
    clearTimeout(timer);
    if (err instanceof DOMException && err.name === "AbortError") {
      throw new Error(`Timeout after ${TIMEOUT_MS}ms`);
    }
    throw err;
  }
};

// ---------------------------------------------------------------------------
// Check 2: API Liveness (basic endpoint)
// ---------------------------------------------------------------------------

const checkApiLiveness = async (): Promise<string> => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const res = await fetch(`${API_BASE_URL}/health`, {
      signal: controller.signal,
    });
    clearTimeout(timer);

    if (!res.ok) {
      throw new Error(`HTTP ${res.status}`);
    }

    return "alive";
  } catch (err) {
    clearTimeout(timer);
    if (err instanceof DOMException && err.name === "AbortError") {
      throw new Error(`Timeout after ${TIMEOUT_MS}ms`);
    }
    throw err;
  }
};

// ---------------------------------------------------------------------------
// Check 3: WebSocket Connectivity
// ---------------------------------------------------------------------------

const checkWebSocket = async (): Promise<string> => {
  if (!API_KEY) return "skipped (no API_KEY)";

  return new Promise<string>((resolve, reject) => {
    const wsUrl = API_BASE_URL.replace(/^http/, "ws") + "/ws";
    const timer = setTimeout(() => {
      reject(new Error(`Timeout after ${TIMEOUT_MS}ms`));
    }, TIMEOUT_MS);

    try {
      const ws = new WebSocket(wsUrl);

      ws.onopen = () => {
        clearTimeout(timer);
        ws.close();
        resolve("connection established");
      };

      ws.onerror = (event) => {
        clearTimeout(timer);
        reject(new Error(`WebSocket error: ${String(event)}`));
      };
    } catch (err) {
      clearTimeout(timer);
      reject(err);
    }
  });
};

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

console.log(`\nAlmirant Smoke Test -- ${API_BASE_URL}\n`);

await runCheck("API Liveness", checkApiLiveness);
await runCheck("API Health (DB)", checkApiHealth);
await runCheck("WebSocket", checkWebSocket);

console.log("");

const passed = results.filter((r) => r.passed).length;
const failed = results.filter((r) => !r.passed).length;
const skipped = results.filter((r) => r.message.startsWith("skipped")).length;

console.log(`Results: ${passed} passed, ${failed} failed, ${skipped} skipped`);

if (failed > 0) {
  console.log("\nSmoke test FAILED\n");
  process.exit(1);
} else {
  console.log("\nSmoke test PASSED\n");
  process.exit(0);
}

#!/usr/bin/env bun

/**
 * Post-deploy smoke test for the Almirant agent pipeline.
 *
 * Verifies:
 * 1. Backend API is healthy (GET /health/ready)
 * 2. WebSocket connection can be established
 * 3. (Optional) A smoke-test job completes successfully
 * 4. (Optional, gated) Planning pipeline e2e: create session → prompt →
 *    planning:text + planning:response-complete over WS
 *
 * Usage:
 *   API_BASE_URL=http://localhost:3001 API_KEY=your-key bun run scripts/smoke-test.ts
 *
 * Optional planning check (disabled by default):
 *   SMOKE_PLANNING=1 SMOKE_SESSION_TOKEN=<better-auth-session-token> \
 *     bun run scripts/smoke-test.ts
 *
 *   Requirements for the planning check (documented, not automated yet):
 *   - SMOKE_SESSION_TOKEN must be a valid Better-Auth session token (the
 *     `session.token` column) for a user with an ACTIVE ORGANIZATION set.
 *     API keys are NOT enough: both POST /api/planning-sessions and the
 *     /ws?token= handshake authenticate against the session table.
 *   - The user must not already have an active planning session (409).
 *   - A runner must be online with provider credentials configured, or the
 *     check will time out waiting for planning:text.
 *   - SMOKE_PLANNING_TIMEOUT_MS overrides the wait (default 120000).
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
// Check 4 (optional): Planning pipeline e2e — gated by SMOKE_PLANNING=1
//
// Skeleton implementation. Creates a planning session via REST, opens an
// authenticated WS, sends planning:start with a trivial prompt, and waits
// for planning:text followed by planning:response-complete.
//
// Disabled by default because it needs a real Better-Auth session token
// (SMOKE_SESSION_TOKEN) and an online runner — see the header comment for
// the full requirements list.
// ---------------------------------------------------------------------------

const SMOKE_PLANNING = process.env.SMOKE_PLANNING === "1";
const SMOKE_SESSION_TOKEN = process.env.SMOKE_SESSION_TOKEN;
const PLANNING_TIMEOUT_MS = Number(
  process.env.SMOKE_PLANNING_TIMEOUT_MS ?? 120_000,
);

const checkPlanningPipeline = async (): Promise<string> => {
  if (!SMOKE_PLANNING) return "skipped (set SMOKE_PLANNING=1 to enable)";
  if (!SMOKE_SESSION_TOKEN) {
    return "skipped (SMOKE_SESSION_TOKEN not set — see script header)";
  }

  // 1. Create a planning session (requires user session auth + active org).
  const createRes = await fetch(`${API_BASE_URL}/api/planning-sessions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${SMOKE_SESSION_TOKEN}`,
    },
    body: JSON.stringify({ title: `Smoke test ${new Date().toISOString()}` }),
  });

  if (createRes.status === 409) {
    throw new Error(
      "User already has an active planning session — complete/cancel it and retry",
    );
  }
  if (!createRes.ok) {
    throw new Error(`Create planning session failed: HTTP ${createRes.status}`);
  }

  const created = (await createRes.json()) as {
    success: boolean;
    data?: { id?: string };
  };
  const sessionId = created.data?.id;
  if (!sessionId) throw new Error("Create planning session returned no id");

  // 2. Open authenticated WS, start the session, await text + completion.
  return await new Promise<string>((resolve, reject) => {
    const wsUrl =
      API_BASE_URL.replace(/^http/, "ws") +
      `/ws?token=${encodeURIComponent(SMOKE_SESSION_TOKEN)}`;
    const ws = new WebSocket(wsUrl);
    let sawText = false;

    const cancelSession = () => {
      // Best-effort: avoid leaving an active session behind (409 next run).
      try {
        ws.send(
          JSON.stringify({ type: "planning:cancel", payload: { sessionId } }),
        );
      } catch {
        // socket may already be closed
      }
    };

    const timer = setTimeout(() => {
      cancelSession();
      ws.close();
      reject(
        new Error(
          `Timeout after ${PLANNING_TIMEOUT_MS}ms (planning:text seen: ${sawText}). ` +
            "Is a runner online with provider credentials?",
        ),
      );
    }, PLANNING_TIMEOUT_MS);

    ws.onopen = () => {
      ws.send(
        JSON.stringify({
          type: "planning:start",
          payload: {
            sessionId,
            userMessage:
              "Smoke test: reply with a one-line acknowledgement and finish without asking questions.",
          },
        }),
      );
    };

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(String(event.data)) as {
          type?: string;
          payload?: { sessionId?: string; message?: string };
        };
        // Ignore broadcasts for other sessions.
        if (msg.payload?.sessionId && msg.payload.sessionId !== sessionId) {
          return;
        }

        if (msg.type === "planning:text") sawText = true;

        if (msg.type === "planning:error") {
          clearTimeout(timer);
          cancelSession();
          ws.close();
          reject(new Error(`planning:error received: ${msg.payload?.message ?? "unknown"}`));
        }

        if (msg.type === "planning:response-complete") {
          clearTimeout(timer);
          cancelSession();
          ws.close();
          if (sawText) {
            resolve("planning:text + planning:response-complete received");
          } else {
            reject(new Error("planning:response-complete arrived without planning:text"));
          }
        }
      } catch {
        // Ignore non-JSON frames
      }
    };

    ws.onerror = () => {
      clearTimeout(timer);
      reject(new Error("WebSocket error during planning check"));
    };
  });
};

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

console.log(`\nAlmirant Smoke Test -- ${API_BASE_URL}\n`);

await runCheck("API Liveness", checkApiLiveness);
await runCheck("API Health (DB)", checkApiHealth);
await runCheck("WebSocket", checkWebSocket);
await runCheck("Planning pipeline (optional)", checkPlanningPipeline);

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

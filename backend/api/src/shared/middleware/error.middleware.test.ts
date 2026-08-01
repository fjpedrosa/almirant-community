import { beforeEach, describe, expect, it, mock } from "bun:test";
import { Elysia, t } from "elysia";
import { createLoggerMock } from "../../test/mocks";

// Mirrors the exact shape of the production leak (issue #237): a
// DrizzleQueryError embeds the raw SQL, column/table names, and bound
// params — including a credential hash — directly in `.message`. That
// message must never reach the HTTP response body for an unhandled error.
class FakeDrizzleQueryError extends Error {
  constructor() {
    super(
      'Failed query: select "api_keys"."id", "api_keys"."key_hash" from "api_keys" ' +
        'where ("api_keys"."key_hash" = $1 and "api_keys"."is_active" = $2) limit $3 ' +
        "params: ab12cd34ef56a1b2c3d4e5f6,true,1",
    );
    this.name = "DrizzleQueryError";
  }
}

const loggerErrorSpy = mock((..._args: unknown[]) => {});
const loggerMocks = createLoggerMock();
mock.module("@almirant/config", () => ({
  ...loggerMocks,
  logger: {
    ...loggerMocks.logger,
    error: loggerErrorSpy,
  },
}));

/**
 * Builds the app the same way production does: `errorMiddleware` and the
 * route under test live in TWO SEPARATE Elysia instances merged with
 * `.use()` (exactly like `index.ts`'s `.use(errorMiddleware)` followed
 * later by `.use(agentsModule.public())`, which itself `.use()`s
 * `workersRoutes`). Defining the route directly on the same instance as
 * `errorMiddleware` would hide the scope bug this suite guards against.
 */
const buildNestedApp = async () => {
  // Dynamic import, deliberately AFTER the `mock.module("@almirant/config", ...)`
  // call above: a static top-level import would be hoisted ahead of that
  // mock registration and pull in the real (unmocked) config module.
  const { errorMiddleware } = await import("./error.middleware");

  const nestedPlugin = new Elysia()
    .get("/boom", () => {
      throw new FakeDrizzleQueryError();
    })
    .post("/validate-me", () => "ok", {
      body: t.Object({ name: t.String() }),
    });

  return new Elysia().use(errorMiddleware).use(nestedPlugin);
};

describe("errorMiddleware — 5xx body sanitization for nested (`.use()`'d) routes", () => {
  beforeEach(() => {
    loggerErrorSpy.mockClear();
  });

  it("never leaks raw SQL, column names, or bound params from an unhandled DB error", async () => {
    const app = await buildNestedApp();

    const res = await app.handle(new Request("http://localhost/boom"));
    const body = (await res.json()) as { success: boolean; error: string };

    expect(res.status).toBe(500);
    expect(body.success).toBe(false);
    expect(body.error).toBe("Internal server error");
    expect(body.error).not.toContain("Failed query");
    expect(body.error).not.toContain("select");
    expect(body.error).not.toContain("api_keys");
    expect(body.error).not.toContain("key_hash");
    expect(body.error).not.toContain("ab12cd34ef56a1b2c3d4e5f6");
  });

  it("still logs the full error detail server-side for debugging", async () => {
    const app = await buildNestedApp();

    await app.handle(new Request("http://localhost/boom"));

    expect(loggerErrorSpy).toHaveBeenCalled();
    const [logPayload] = loggerErrorSpy.mock.calls[0] as [Record<string, unknown>, string];
    const loggedError = logPayload.err as Error;
    expect(loggedError.message).toContain("Failed query");
    expect(loggedError.message).toContain("api_keys");
    expect(loggedError.message).toContain("key_hash");
  });

  it("keeps the curated 400 message for typed VALIDATION errors on nested routes", async () => {
    const app = await buildNestedApp();

    const res = await app.handle(
      new Request("http://localhost/validate-me", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: 123 }),
      }),
    );
    const body = (await res.json()) as { success: boolean; error: string };

    expect(res.status).toBe(400);
    expect(body.success).toBe(false);
    // Elysia's own schema-violation message — controlled/typed, safe to
    // surface, and must NOT be collapsed to the generic 500 message.
    expect(body.error.length).toBeGreaterThan(0);
    expect(body.error).not.toBe("Internal server error");
  });

  it("keeps the curated 404 message for unmatched nested routes", async () => {
    const app = await buildNestedApp();

    const res = await app.handle(new Request("http://localhost/does-not-exist"));
    const body = (await res.json()) as { success: boolean; error: string };

    expect(res.status).toBe(404);
    expect(body.success).toBe(false);
    expect(body.error).toBe("Not found");
  });
});

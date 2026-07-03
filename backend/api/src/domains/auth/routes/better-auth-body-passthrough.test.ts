import { describe, it, expect, beforeAll, afterAll, mock } from "bun:test";
import { Elysia } from "elysia";
import * as authActual from "../better-auth/auth";

// ---------------------------------------------------------------------------
// Regression test for the Elysia ↔ Better-Auth "Body already used" bug.
//
// A Web Standard Request body can be read only once. Elysia parses the body by
// Content-Type in its lifecycle; if that runs before we delegate, Better-Auth's
// handler re-reads the body and throws `TypeError: Body already used` → 500 on
// EVERY POST (sign-in/email, sign-in/social, sign-up, …). The wildcard route
// must be declared with `{ parse: "none" }` so the raw request reaches the
// handler intact. This test stubs getAuth() with an echo handler and asserts
// the POST body arrives unconsumed.
//
// Bun's `mock.module` is process-global and `mock.restore()` does NOT clear it,
// so we capture the real module and re-register it in afterAll.
// ---------------------------------------------------------------------------

const realGetAuth = authActual.getAuth;

// Echo handler: proves whether the body survived Elysia's lifecycle.
mock.module("../better-auth/auth", () => ({
  ...authActual,
  getAuth: async () => ({
    handler: async (req: Request) =>
      new Response(
        JSON.stringify({ bodyUsed: req.bodyUsed, body: await req.text() }),
        { headers: { "content-type": "application/json" } },
      ),
  }),
}));

describe("betterAuthRoutes body passthrough (parse: none)", () => {
  let app: Elysia<any, any, any, any, any, any, any>;

  beforeAll(async () => {
    const { betterAuthRoutes } = await import("./better-auth.routes");
    app = new Elysia().use(betterAuthRoutes) as unknown as typeof app;
  });

  afterAll(() => {
    mock.module("../better-auth/auth", () => ({
      ...authActual,
      getAuth: realGetAuth,
    }));
  });

  it("hands a JSON POST body to the handler unconsumed", async () => {
    const payload = { provider: "google", callbackURL: "https://cloud.almirant.ai/board" };

    const response = await app.handle(
      new Request("http://localhost/api/auth/sign-in/social", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      }),
    );

    expect(response.status).toBe(200);
    const out = (await response.json()) as { bodyUsed: boolean; body: string };

    // With Elysia parsing the body first, bodyUsed would be true and body "".
    expect(out.bodyUsed).toBe(false);
    expect(JSON.parse(out.body)).toEqual(payload);
  });

  it("also passes through form-encoded bodies untouched", async () => {
    const response = await app.handle(
      new Request("http://localhost/api/auth/sign-in/email", {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: "email=a%40b.com&password=secret",
      }),
    );

    expect(response.status).toBe(200);
    const out = (await response.json()) as { bodyUsed: boolean; body: string };
    expect(out.bodyUsed).toBe(false);
    expect(out.body).toBe("email=a%40b.com&password=secret");
  });
});

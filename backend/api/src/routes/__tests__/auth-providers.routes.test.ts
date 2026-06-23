import { describe, it, expect, beforeAll, afterAll, mock } from "bun:test";
import { Elysia } from "elysia";
import * as sharedActual from "@almirant/shared";

// Capture the real implementation BEFORE installing the mock so we can
// restore it in afterAll — bun's `mock.module` is process-global and
// `mock.restore()` does NOT clear module registrations, which makes the
// stub leak into subsequent test files (see feedback_bun_mock_module_leak).
const realGetAuthProviders = sharedActual.getAuthProviders;

const stubGetAuthProviders = () => ({
  list: () => [
    { id: "google", displayName: "Google", type: "oauth" as const },
    { id: "email-password", displayName: "Email & password", type: "credentials" as const },
  ],
  has: (id: string) => ["google", "email-password"].includes(id),
});

// Install the stub — spread the real module so unrelated exports keep working.
mock.module("@almirant/shared", () => ({
  ...sharedActual,
  getAuthProviders: stubGetAuthProviders,
}));

interface ProvidersResponse {
  success: boolean;
  data: {
    providers: Array<{ id: string; displayName: string; type: string }>;
  };
}

describe("GET /api/auth/providers", () => {
  // Use a generic Elysia app as the shared mount — the narrower type from
  // .use(authProvidersRoutes) is not needed for integration-style tests.
  let app: Elysia<any, any, any, any, any, any, any>;

  beforeAll(async () => {
    const { authProvidersRoutes } = await import("../auth-providers.routes");
    app = new Elysia().use(authProvidersRoutes) as unknown as typeof app;
  });

  afterAll(() => {
    // Undo the module-level stub so other test files see the real module.
    mock.module("@almirant/shared", () => ({
      ...sharedActual,
      getAuthProviders: realGetAuthProviders,
    }));
  });

  it("returns the list of configured providers", async () => {
    const response = await app.handle(
      new Request("http://localhost/api/auth/providers")
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as ProvidersResponse;
    expect(body.success).toBe(true);
    expect(body.data.providers).toHaveLength(2);
    expect(body.data.providers[0]!.id).toBe("google");
    expect(body.data.providers[0]!.displayName).toBe("Google");
    expect(body.data.providers[0]!.type).toBe("oauth");
    expect(body.data.providers[1]!.id).toBe("email-password");
    expect(body.data.providers[1]!.type).toBe("credentials");
  });

  it("endpoint is unauthenticated (no bearer token needed)", async () => {
    // Just verify that hitting it without auth headers returns 200, not 401.
    const response = await app.handle(
      new Request("http://localhost/api/auth/providers")
    );
    expect(response.status).not.toBe(401);
    expect(response.status).toBe(200);
  });
});

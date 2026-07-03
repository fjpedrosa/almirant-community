import { describe, it, expect, beforeAll, afterAll, mock } from "bun:test";
import { Elysia } from "elysia";
import * as sharedActual from "@almirant/shared";
import * as instanceConfigActual from "../../instance/services/instance-config-service";
import * as authBootstrapActual from "../better-auth/auth-bootstrap";

// ---------------------------------------------------------------------------
// Characterization test for the two-route auth surface mounted at ROOT level:
//
//   .use(authProvidersRoutes)   // static  GET /api/auth/providers
//                               //         GET /api/auth/bootstrap-status
//   .use(betterAuthRoutes)      // wildcard .all("/api/auth/*") -> auth.handler
//
// It asserts the SAME registration order used in src/index.ts so the static
// routes resolve as CONCRETE routes and are NOT swallowed by the Better-Auth
// wildcard, while every OTHER /api/auth/* path is delegated to auth.handler.
//
// Bun's `mock.module` is process-global and `mock.restore()` does NOT clear it,
// so we capture the REAL modules up front and re-register them in afterAll to
// keep the stubs from leaking into sibling test files
// (see feedback_bun_mock_module_leak / the canonical pattern in
//  src/infrastructure/extensions/__tests__/default-auth-provider-registry.test.ts).
// ---------------------------------------------------------------------------

const realGetAuthProviders = sharedActual.getAuthProviders;
const realGetPublicInstanceConfig = instanceConfigActual.getPublicInstanceConfig;
const realGetAuthBootstrapStatus = authBootstrapActual.getAuthBootstrapStatus;

const STUB_PROVIDERS = [
  { id: "google", displayName: "Google", type: "oauth" as const },
  { id: "email-password", displayName: "Email & password", type: "credentials" as const },
];

const STUB_BOOTSTRAP_STATUS = {
  hasUsers: true,
  needsInitialAdminSetup: false,
  allowRegistration: false,
};

const STUB_ONBOARDING_COMPLETED = true;

// Stub the provider registry — the real getAuthProviders() throws unless the
// app bootstrapped it, so a stub is required just to render the list.
mock.module("@almirant/shared", () => ({
  ...sharedActual,
  getAuthProviders: () => ({
    list: () => STUB_PROVIDERS,
    has: (id: string) => STUB_PROVIDERS.some((p) => p.id === id),
  }),
}));

// Stub the instance-config accessor so neither getAuth() (which reads publicUrl
// to decide whether to recreate the Better-Auth instance) nor the
// bootstrap-status route touch the database. publicUrl=null keeps the auth
// instance at its module-load default (no recreation).
mock.module("../../instance/services/instance-config-service", () => ({
  ...instanceConfigActual,
  getPublicInstanceConfig: async () => ({
    publicUrl: null,
    githubAppSlug: null,
    onboardingCompleted: STUB_ONBOARDING_COMPLETED,
  }),
}));

// Stub the bootstrap-status query so the route returns a deterministic shape
// without a live "user" / system_settings query.
mock.module("../better-auth/auth-bootstrap", () => ({
  ...authBootstrapActual,
  getAuthBootstrapStatus: async () => STUB_BOOTSTRAP_STATUS,
}));

interface SuccessEnvelope<T> {
  success: boolean;
  data: T;
}

interface ProvidersData {
  providers: Array<{ id: string; displayName: string; type: string }>;
}

interface BootstrapStatusData {
  hasUsers: boolean;
  needsInitialAdminSetup: boolean;
  allowRegistration: boolean;
  onboardingCompleted: boolean;
}

describe("betterAuthRoutes + authProvidersRoutes mount", () => {
  // Generic Elysia type — the narrow inferred type from .use(...) is irrelevant
  // for integration-style route assertions.
  let app: Elysia<any, any, any, any, any, any, any>;

  beforeAll(async () => {
    const { authProvidersRoutes } = await import("../../../routes/auth-providers.routes");
    const { betterAuthRoutes } = await import("./better-auth.routes");

    // Mirror the exact registration order from src/index.ts: static provider
    // routes FIRST, Better-Auth wildcard SECOND.
    app = new Elysia()
      .use(authProvidersRoutes)
      .use(betterAuthRoutes) as unknown as typeof app;
  });

  afterAll(() => {
    // Undo the process-global module stubs so other test files see the reals.
    mock.module("@almirant/shared", () => ({
      ...sharedActual,
      getAuthProviders: realGetAuthProviders,
    }));
    mock.module("../../instance/services/instance-config-service", () => ({
      ...instanceConfigActual,
      getPublicInstanceConfig: realGetPublicInstanceConfig,
    }));
    mock.module("../better-auth/auth-bootstrap", () => ({
      ...authBootstrapActual,
      getAuthBootstrapStatus: realGetAuthBootstrapStatus,
    }));
  });

  it("resolves GET /api/auth/providers as the concrete static route (not the wildcard)", async () => {
    const response = await app.handle(
      new Request("http://localhost/api/auth/providers"),
    );

    expect(response.status).toBe(200);
    const body = (await response.json()) as SuccessEnvelope<ProvidersData>;

    // successResponse wrapper proves the STATIC handler answered — the
    // Better-Auth wildcard would 404 (no such Better-Auth endpoint) instead.
    expect(body.success).toBe(true);
    expect(body.data.providers).toEqual(STUB_PROVIDERS);
  });

  it("resolves GET /api/auth/bootstrap-status with the full status + onboarding shape", async () => {
    const response = await app.handle(
      new Request("http://localhost/api/auth/bootstrap-status"),
    );

    expect(response.status).toBe(200);
    const body = (await response.json()) as SuccessEnvelope<BootstrapStatusData>;

    expect(body.success).toBe(true);
    expect(body.data).toEqual({
      hasUsers: STUB_BOOTSTRAP_STATUS.hasUsers,
      needsInitialAdminSetup: STUB_BOOTSTRAP_STATUS.needsInitialAdminSetup,
      allowRegistration: STUB_BOOTSTRAP_STATUS.allowRegistration,
      onboardingCompleted: STUB_ONBOARDING_COMPLETED,
    });
  });

  it("delegates other /api/auth/* paths to the Better-Auth handler", async () => {
    // GET /api/auth/ok is a built-in Better-Auth health endpoint that returns
    // { ok: true } WITHOUT touching the database. It is NOT one of the static
    // routes, so reaching it proves the wildcard delegated to auth.handler.
    const response = await app.handle(
      new Request("http://localhost/api/auth/ok"),
    );

    expect(response.status).toBe(200);
    const body = (await response.json()) as { ok?: boolean; success?: boolean };

    // Better-Auth's raw response — NOT wrapped in the successResponse envelope,
    // which would be present had a static route (mistakenly) matched.
    expect(body.ok).toBe(true);
    expect(body.success).toBeUndefined();
  });

  it("does not swallow the static routes behind the wildcard (ordering is explicit)", async () => {
    // Both a static path and a delegated path resolve correctly from the same
    // app, demonstrating static-segment routes win over the /api/auth/* wildcard
    // when registered first (as in src/index.ts).
    const providers = await app.handle(
      new Request("http://localhost/api/auth/providers"),
    );
    const delegated = await app.handle(
      new Request("http://localhost/api/auth/ok"),
    );

    const providersBody = (await providers.json()) as SuccessEnvelope<ProvidersData>;
    const delegatedBody = (await delegated.json()) as { ok?: boolean };

    expect(providersBody.success).toBe(true);
    expect(providersBody.data.providers).toHaveLength(STUB_PROVIDERS.length);
    expect(delegatedBody.ok).toBe(true);
  });
});

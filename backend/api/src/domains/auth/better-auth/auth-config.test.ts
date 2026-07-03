import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  mock,
} from "bun:test";

// We assert the shape of the Better-Auth config that `createAuthInstance` bakes.
// `@almirant/config` parses env in an IIFE at module load, so the mock MUST be
// registered BEFORE the dynamic import of auth.ts. We start from a copy of the
// REAL parsed env (so every field the transitive import graph reads at load is
// present and valid) and mutate the auth-relevant keys per scenario. The real
// module is restored in afterAll so the registration never leaks.

let realConfig: typeof import("@almirant/config");
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let mockEnv: Record<string, any>;
let createAuthInstance: typeof import("./auth.ts").createAuthInstance;
let getTrustedOrigins: typeof import("./auth.ts").getTrustedOrigins;

beforeAll(async () => {
  realConfig = await import("@almirant/config");
  mockEnv = { ...realConfig.env };
  mock.module("@almirant/config", () => ({ ...realConfig, env: mockEnv }));
  const mod = await import("./auth.ts");
  createAuthInstance = mod.createAuthInstance;
  getTrustedOrigins = mod.getTrustedOrigins;
});

afterAll(() => {
  mock.module("@almirant/config", () => realConfig);
});

beforeEach(() => {
  // Reset the auth-relevant keys to a known baseline before each scenario.
  mockEnv.BETTER_AUTH_SECRET = "test-secret-32-bytes-xxxxxxxxxxxx";
  mockEnv.BETTER_AUTH_URL = undefined;
  mockEnv.CORS_ORIGIN = "http://localhost:3000";
  mockEnv.BETTER_AUTH_TRUSTED_ORIGINS = undefined;
  mockEnv.GOOGLE_CLIENT_ID = undefined;
  mockEnv.GOOGLE_CLIENT_SECRET = undefined;
  mockEnv.AUTH_COOKIE_DOMAIN = undefined;
});

describe("createAuthInstance social providers", () => {
  it("wires Google ONLY when both client id and secret are set", () => {
    mockEnv.GOOGLE_CLIENT_ID = "google-client-id";
    mockEnv.GOOGLE_CLIENT_SECRET = "google-client-secret";

    const options = createAuthInstance(null).options;

    expect(options.socialProviders?.google).toBeDefined();
    expect(options.socialProviders!.google!.clientId).toBe("google-client-id");
    expect(options.socialProviders!.google!.clientSecret).toBe(
      "google-client-secret",
    );
    expect(options.socialProviders!.google!.overrideUserInfoOnSignIn).toBe(true);
  });

  it("omits social providers when Google credentials are absent", () => {
    const options = createAuthInstance(null).options;

    expect(options.socialProviders).toBeUndefined();
  });

  it("omits social providers when only the client id is set (secret missing)", () => {
    mockEnv.GOOGLE_CLIENT_ID = "google-client-id";
    // secret stays undefined

    const options = createAuthInstance(null).options;

    expect(options.socialProviders).toBeUndefined();
  });
});

describe("createAuthInstance cross-subdomain cookies", () => {
  it("enables cross-subdomain cookies with the configured domain when set", () => {
    mockEnv.AUTH_COOKIE_DOMAIN = ".almirant.ai";

    const options = createAuthInstance(null).options;

    expect(options.advanced!.crossSubDomainCookies!.enabled).toBe(true);
    expect(options.advanced!.crossSubDomainCookies!.domain).toBe(".almirant.ai");
  });

  it("disables cross-subdomain cookies (host-only) when the domain is unset", () => {
    const options = createAuthInstance(null).options;

    expect(options.advanced!.crossSubDomainCookies!.enabled).toBe(false);
    expect(options.advanced!.crossSubDomainCookies!.domain).toBeUndefined();
  });
});

describe("createAuthInstance cookie attributes", () => {
  it("preserves httpOnly:false on the session token cookie", () => {
    const options = createAuthInstance(null).options;

    expect(
      options.advanced!.cookies!.session_token!.attributes!.httpOnly,
    ).toBe(false);
  });
});

describe("createAuthInstance trusted origins", () => {
  it("wires trustedOrigins from getTrustedOrigins for the given runtime url", () => {
    mockEnv.CORS_ORIGIN = "https://app.example.com";
    mockEnv.BETTER_AUTH_TRUSTED_ORIGINS = "https://extra.example.com";
    const runtimeUrl = "https://runtime.example.com";

    const options = createAuthInstance(runtimeUrl).options;

    expect(options.trustedOrigins).toEqual(getTrustedOrigins(runtimeUrl));
    // sanity: the configured origins actually made it through
    expect(options.trustedOrigins).toContain("https://app.example.com");
    expect(options.trustedOrigins).toContain("https://extra.example.com");
    expect(options.trustedOrigins).toContain("https://runtime.example.com");
  });
});

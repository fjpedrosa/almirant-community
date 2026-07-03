import { describe, it, expect, mock, beforeAll, afterAll } from "bun:test";

// ── Mock leak safety ────────────────────────────────────────────────────────
// `mock.module()` is PROCESS-GLOBAL and `mock.restore()` does NOT clear it, so
// we capture the real modules first and re-register them in afterAll. Both
// mocks MUST be registered BEFORE the dynamic import of `runtime-cors` because
// that module reads `env.CORS_ORIGIN` at load time (IIFE-style top-level const)
// and imports the instance-config-service (which pulls in the DB layer).
let realConfig: unknown;
let realInstanceService: unknown;

// runtime-cors imports the instance-config-service via this exact specifier;
// the test file sits in the same directory as runtime-cors.ts, so the relative
// path resolves to the identical module and the mock keys match.
const INSTANCE_SERVICE_SPECIFIER =
  "../../domains/instance/services/instance-config-service";

describe("runtime-cors isOriginAllowed", () => {
  let isOriginAllowed: (origin: string) => boolean;

  beforeAll(async () => {
    realConfig = await import("@almirant/config");
    realInstanceService = await import(INSTANCE_SERVICE_SPECIFIER);

    // Inject a CORS_ORIGIN that explicitly lists the two production origins plus
    // the localhost default. Note: NO www.almirant.ai — the apex is listed but
    // the www subdomain is not, which is exactly the case we assert is rejected.
    mock.module("@almirant/config", () => ({
      env: {
        CORS_ORIGIN:
          "http://localhost:3000,https://cloud.almirant.ai,https://almirant.ai",
      },
    }));

    // Prevent the real DB-backed service from loading. isOriginAllowed never
    // touches the DB origin in these tests (initRuntimeCors is not called, so
    // dbOrigin stays null), but the top-level import must resolve to something.
    mock.module(INSTANCE_SERVICE_SPECIFIER, () => ({
      getPublicInstanceConfig: mock(async () => ({ publicUrl: null })),
    }));

    const mod = await import("./runtime-cors");
    isOriginAllowed = mod.isOriginAllowed;
  });

  afterAll(() => {
    // Restore the real modules so the mocks do not leak into sibling test files.
    mock.module("@almirant/config", () => realConfig);
    mock.module(INSTANCE_SERVICE_SPECIFIER, () => realInstanceService);
  });

  it("allows an explicitly-listed production origin (cloud.almirant.ai)", () => {
    expect(isOriginAllowed("https://cloud.almirant.ai")).toBe(true);
  });

  it("allows an explicitly-listed production origin (apex almirant.ai)", () => {
    expect(isOriginAllowed("https://almirant.ai")).toBe(true);
  });

  it("rejects a non-listed subdomain (www.almirant.ai) — NO www/apex auto-expansion", () => {
    // Unlike Better-Auth trustedOrigins, CORS does EXACT-origin matching. The
    // apex is allowed but www is a distinct origin and must be rejected.
    expect(isOriginAllowed("https://www.almirant.ai")).toBe(false);
  });

  it("rejects a non-listed sibling subdomain (api.almirant.ai)", () => {
    expect(isOriginAllowed("https://api.almirant.ai")).toBe(false);
  });

  it("does NOT wildcard-match arbitrary origins", () => {
    expect(isOriginAllowed("https://evil.com")).toBe(false);
    expect(isOriginAllowed("*")).toBe(false);
  });

  it("keeps the localhost default origin allowed", () => {
    expect(isOriginAllowed("http://localhost:3000")).toBe(true);
  });

  it("rejects the apex over the wrong scheme (exact origin includes scheme)", () => {
    // https://almirant.ai is listed; http://almirant.ai is a different origin.
    expect(isOriginAllowed("http://almirant.ai")).toBe(false);
  });

  it("rejects an empty origin string", () => {
    expect(isOriginAllowed("")).toBe(false);
  });
});

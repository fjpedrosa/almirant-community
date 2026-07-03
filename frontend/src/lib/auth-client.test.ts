import {
  afterAll,
  beforeEach,
  describe,
  expect,
  it,
  mock,
} from "bun:test";

/**
 * Characterization tests for the already-refactored Better-Auth browser client.
 *
 * `auth-client.ts` calls `createAuthClient(...)` at MODULE LOAD, resolving
 * `baseURL` from env at that point. We MOCK `better-auth/react` +
 * `better-auth/client/plugins` to capture the config object the module passes,
 * then re-load a FRESH copy of the module (query-string cache-bust) per env
 * scenario so `resolveAuthBaseURL()` re-evaluates.
 *
 * `mock.module()` is PROCESS-GLOBAL and survives `mock.restore()`, so we capture
 * the real modules up front and restore them in `afterAll` to avoid leaking into
 * sibling test files.
 */

// Capture real modules BEFORE mocking (leak-safety).
const realReact = await import("better-auth/react");
const realPlugins = await import("better-auth/client/plugins");

interface CapturedConfig {
  baseURL?: string;
  fetchOptions?: { credentials?: string };
  plugins?: Array<Record<string, unknown>>;
}

let capturedConfig: CapturedConfig | undefined;

mock.module("better-auth/react", () => ({
  createAuthClient: (config: CapturedConfig) => {
    capturedConfig = config;
    return { __mockClient: true };
  },
}));

mock.module("better-auth/client/plugins", () => ({
  organizationClient: () => ({ __plugin: "organizationClient" }),
  inferAdditionalFields: (opts: unknown) => ({
    __plugin: "inferAdditionalFields",
    opts,
  }),
}));

let seq = 0;
const freshModule = async (): Promise<typeof import("./auth-client")> => {
  seq += 1;
  return import(`./auth-client.ts?cb=${seq}`);
};

const findPlugin = (name: string): Record<string, unknown> | undefined =>
  capturedConfig?.plugins?.find((p) => p.__plugin === name);

beforeEach(() => {
  capturedConfig = undefined;
  delete process.env.NEXT_PUBLIC_AUTH_URL;
  delete process.env.NEXT_PUBLIC_API_URL;
});

afterAll(() => {
  mock.module("better-auth/react", () => realReact);
  mock.module("better-auth/client/plugins", () => realPlugins);
  delete process.env.NEXT_PUBLIC_AUTH_URL;
  delete process.env.NEXT_PUBLIC_API_URL;
});

describe("auth-client baseURL resolution", () => {
  it("uses NEXT_PUBLIC_AUTH_URL when present", async () => {
    process.env.NEXT_PUBLIC_AUTH_URL = "https://auth.almirant.ai";
    process.env.NEXT_PUBLIC_API_URL = "https://api.almirant.ai/api";

    await freshModule();

    expect(capturedConfig?.baseURL).toBe("https://auth.almirant.ai");
  });

  it("falls back to NEXT_PUBLIC_API_URL when AUTH_URL is unset", async () => {
    process.env.NEXT_PUBLIC_API_URL = "https://api.almirant.ai";

    await freshModule();

    expect(capturedConfig?.baseURL).toBe("https://api.almirant.ai");
  });

  it("leaves baseURL undefined (same-origin) when both are unset", async () => {
    await freshModule();

    expect(capturedConfig?.baseURL).toBeUndefined();
  });

  it("leaves baseURL undefined when the configured value is a relative path", async () => {
    process.env.NEXT_PUBLIC_AUTH_URL = "/api";

    await freshModule();

    expect(capturedConfig?.baseURL).toBeUndefined();
  });
});

describe("auth-client fetch + plugin wiring", () => {
  it("includes credentials so the session cookie travels with requests", async () => {
    await freshModule();

    expect(capturedConfig?.fetchOptions?.credentials).toBe("include");
  });

  it("registers the organization client plugin", async () => {
    await freshModule();

    expect(findPlugin("organizationClient")).toBeDefined();
  });

  it("declares the role + locale additional user fields as strings", async () => {
    await freshModule();

    const plugin = findPlugin("inferAdditionalFields");
    expect(plugin).toBeDefined();

    const opts = plugin?.opts as {
      user: {
        role: { type: string };
        locale: { type: string };
      };
    };
    expect(opts.user.role.type).toBe("string");
    expect(opts.user.locale.type).toBe("string");
  });
});

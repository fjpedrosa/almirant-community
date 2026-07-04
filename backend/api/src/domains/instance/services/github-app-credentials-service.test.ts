import {
  describe,
  it,
  expect,
  beforeAll,
  afterAll,
  beforeEach,
  mock,
} from "bun:test";
import { generateKeyPairSync } from "node:crypto";
import * as configActual from "@almirant/config";

// ---------------------------------------------------------------------------
// Env-sourced GitHub App slug resolution (cloud flow).
//
// In cloud, the central GitHub App is provided via env vars
// (GITHUB_APP_ID / GITHUB_PRIVATE_KEY) but GitHub never issues a "slug" via
// env — it is only known by calling GET https://api.github.com/app. This suite
// pins that the service resolves the slug from the API, exposes it via
// getGithubAppStatus(), and caches it (no second API call).
//
// Config is mocked (real env spread + GitHub overrides + noop logger) so the
// test is self-contained. ENCRYPTION_KEY is left undefined so loadFromDb()
// short-circuits without touching the database. Requires DATABASE_URL +
// NODE_ENV=test on the command line (like every other backend test) so the
// real @almirant/config parses at import time.
// ---------------------------------------------------------------------------

const { privateKey } = generateKeyPairSync("rsa", {
  modulusLength: 2048,
  publicKeyEncoding: { type: "spki", format: "pem" },
  privateKeyEncoding: { type: "pkcs8", format: "pem" },
});
const TEST_APP_ID = "123456";
const TEST_PRIVATE_KEY_B64 = Buffer.from(privateKey).toString("base64");

const realEnv = configActual.env;
const realLogger = configActual.logger;
const realFetch = globalThis.fetch;

let fetchCalls: string[] = [];
let appResponse: { ok: boolean; status: number; body: unknown } = {
  ok: true,
  status: 200,
  body: { name: "Almirant App", slug: "almirant-app" },
};

mock.module("@almirant/config", () => ({
  ...configActual,
  env: {
    ...realEnv,
    ENCRYPTION_KEY: undefined,
    GITHUB_APP_ID: TEST_APP_ID,
    GITHUB_PRIVATE_KEY: TEST_PRIVATE_KEY_B64,
    GITHUB_CLIENT_ID: "Iv1.testclient",
    GITHUB_CLIENT_SECRET: "test-client-secret",
    GITHUB_WEBHOOK_SECRET: "test-webhook-secret",
  },
  logger: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} },
}));

describe("github-app-credentials-service: env slug resolution", () => {
  let getGithubAppStatus: typeof import("./github-app-credentials-service").getGithubAppStatus;
  let resetCaches: typeof import("./github-app-credentials-service").__clearGithubAppCredentialsCacheForTests;

  beforeAll(async () => {
    const mod = await import("./github-app-credentials-service");
    getGithubAppStatus = mod.getGithubAppStatus;
    resetCaches = mod.__clearGithubAppCredentialsCacheForTests;
  });

  beforeEach(() => {
    resetCaches();
    fetchCalls = [];
    appResponse = {
      ok: true,
      status: 200,
      body: { name: "Almirant App", slug: "almirant-app" },
    };
    globalThis.fetch = (async (input: string | URL | Request) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url === "https://api.github.com/app") {
        fetchCalls.push(url);
        return new Response(JSON.stringify(appResponse.body), {
          status: appResponse.status,
        });
      }
      return realFetch(input);
    }) as typeof globalThis.fetch;
  });

  afterAll(() => {
    globalThis.fetch = realFetch;
    mock.module("@almirant/config", () => ({
      ...configActual,
      env: realEnv,
      logger: realLogger,
    }));
  });

  it("resolves the slug from GET /app and caches it (single API call)", async () => {
    const first = await getGithubAppStatus();
    const second = await getGithubAppStatus();

    expect(first.configured).toBe(true);
    expect(first.source).toBe("env");
    expect(first.slug).toBe("almirant-app");
    expect(second.slug).toBe("almirant-app");
    // Second call must be served from cache — no second GitHub API round-trip.
    expect(fetchCalls).toHaveLength(1);
  });

  it("returns slug=null gracefully when GET /app fails (does not throw)", async () => {
    appResponse = { ok: false, status: 500, body: { message: "boom" } };

    const status = await getGithubAppStatus();

    expect(status.configured).toBe(true);
    expect(status.source).toBe("env");
    expect(status.slug).toBeNull();
    expect(fetchCalls).toHaveLength(1);
  });

  it("does not cache a failed resolution — a later call retries", async () => {
    appResponse = { ok: false, status: 503, body: {} };
    const failed = await getGithubAppStatus();
    expect(failed.slug).toBeNull();

    appResponse = {
      ok: true,
      status: 200,
      body: { slug: "almirant-app" },
    };
    const recovered = await getGithubAppStatus();
    expect(recovered.slug).toBe("almirant-app");
    // First (failed) + second (success) => two attempts, failure not cached.
    expect(fetchCalls).toHaveLength(2);
  });
});

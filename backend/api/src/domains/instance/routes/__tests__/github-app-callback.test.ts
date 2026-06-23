import {
  describe,
  it,
  expect,
  beforeAll,
  afterAll,
  beforeEach,
  mock,
} from "bun:test";
import { Elysia } from "elysia";
import * as instanceConfigActual from "../../services/instance-config-service";
import * as credentialsServiceActual from "../../services/github-app-credentials-service";
import * as databaseActual from "@almirant/database";
import * as posthogActual from "../../../../shared/services/posthog-service";

const realGetInstanceConfig = instanceConfigActual.getInstanceConfig;
const realSaveCredentials = credentialsServiceActual.saveGithubAppCredentials;
const realGetActiveManifestState = databaseActual.getActiveManifestState;
const realDeleteManifestState = databaseActual.deleteManifestStateByState;
const realCaptureServerEvent = posthogActual.captureServerEvent;
const realFetch = globalThis.fetch;

interface SavedCredentials {
  appId: string;
  slug: string;
  clientId: string;
  clientSecret: string;
  webhookSecret: string;
  privateKeyPem: string;
}

let savedCredentialsCalls: Array<{ creds: SavedCredentials; userId: string }> =
  [];
let deletedStates: string[] = [];
let captureEventCalls: Array<{
  distinctId: string;
  event: string;
  properties: Record<string, unknown> | undefined;
}> = [];

let storedState: {
  state: string;
  appName: string;
  returnTo: string | null;
  expiresAt: Date;
} | null = null;

let fetchResponse: { ok: boolean; status: number; body: unknown } = {
  ok: true,
  status: 201,
  body: {
    id: 12345,
    slug: "almirant-test",
    client_id: "Iv1.test",
    client_secret: "secret-test",
    webhook_secret: "wh-secret",
    pem: "test-private-key-pem",
  },
};

mock.module("../../services/instance-config-service", () => ({
  ...instanceConfigActual,
  getInstanceConfig: async () => ({
    publicUrl: "https://test.almirant.example.com",
    githubAppSlug: null,
    githubAppId: null,
    onboardingCompletedAt: null,
    skippedOnboardingSteps: [],
  }),
}));

mock.module("../../services/github-app-credentials-service", () => ({
  ...credentialsServiceActual,
  saveGithubAppCredentials: async (
    creds: SavedCredentials,
    userId: string,
  ) => {
    savedCredentialsCalls.push({ creds, userId });
  },
}));

mock.module("@almirant/database", () => ({
  ...databaseActual,
  getActiveManifestState: async (state: string) => {
    if (storedState && storedState.state === state) return storedState;
    return null;
  },
  deleteManifestStateByState: async (state: string) => {
    deletedStates.push(state);
  },
}));

mock.module("../../../../shared/services/posthog-service", () => ({
  ...posthogActual,
  captureServerEvent: (
    distinctId: string,
    event: string,
    properties?: Record<string, unknown>,
  ) => {
    captureEventCalls.push({ distinctId, event, properties });
  },
}));

describe("GET /instance/github-app/manifest-callback", () => {
  let app: Elysia<any, any, any, any, any, any, any>;

  beforeAll(async () => {
    const { githubAppRoutes } = await import("../github-app.routes");
    app = new Elysia()
      .derive(() => ({ user: { id: "admin-user-id", role: "admin" } }))
      .use(githubAppRoutes) as unknown as typeof app;
  });

  beforeEach(() => {
    savedCredentialsCalls = [];
    deletedStates = [];
    captureEventCalls = [];
    storedState = {
      state: "valid-state-12345",
      appName: "My App",
      returnTo: "/onboarding",
      expiresAt: new Date(Date.now() + 60_000),
    };
    fetchResponse = {
      ok: true,
      status: 201,
      body: {
        id: 12345,
        slug: "almirant-test",
        client_id: "Iv1.test",
        client_secret: "secret-test",
        webhook_secret: "wh-secret",
        pem: "test-private-key-pem",
      },
    };
    globalThis.fetch = (async (
      input: string | URL | Request,
      init?: RequestInit,
    ) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url.includes("api.github.com/app-manifests/")) {
        return new Response(JSON.stringify(fetchResponse.body), {
          status: fetchResponse.status,
        });
      }
      return realFetch(input, init);
    }) as typeof globalThis.fetch;
  });

  afterAll(() => {
    globalThis.fetch = realFetch;
    mock.module("../../services/instance-config-service", () => ({
      ...instanceConfigActual,
      getInstanceConfig: realGetInstanceConfig,
    }));
    mock.module("../../services/github-app-credentials-service", () => ({
      ...credentialsServiceActual,
      saveGithubAppCredentials: realSaveCredentials,
    }));
    mock.module("@almirant/database", () => ({
      ...databaseActual,
      getActiveManifestState: realGetActiveManifestState,
      deleteManifestStateByState: realDeleteManifestState,
    }));
    mock.module("../../../../shared/services/posthog-service", () => ({
      ...posthogActual,
      captureServerEvent: realCaptureServerEvent,
    }));
  });

  it("returns 400 when state row not found in DB", async () => {
    storedState = null;
    const response = await app.handle(
      new Request(
        "http://localhost/instance/github-app/manifest-callback?code=abc&state=missing",
      ),
    );
    expect(response.status).toBe(400);
  });

  it("returns 400 when state row is expired", async () => {
    storedState = {
      state: "valid-state-12345",
      appName: "My App",
      returnTo: "/onboarding",
      expiresAt: new Date(Date.now() - 1000),
    };
    // Simulate repository returning null for expired (real impl uses gt(expiresAt, now))
    const expiredState = storedState;
    storedState = null; // getActiveManifestState only returns active rows
    const response = await app.handle(
      new Request(
        `http://localhost/instance/github-app/manifest-callback?code=abc&state=${expiredState.state}`,
      ),
    );
    expect(response.status).toBe(400);
  });

  it("on success: saves credentials, deletes state, redirects 302 with returnTo", async () => {
    const response = await app.handle(
      new Request(
        "http://localhost/instance/github-app/manifest-callback?code=abc&state=valid-state-12345",
      ),
    );

    expect(response.status).toBe(302);
    const location = response.headers.get("location");
    expect(location).toBe(
      "https://test.almirant.example.com/onboarding?step=github&success=1",
    );

    expect(savedCredentialsCalls).toHaveLength(1);
    expect(savedCredentialsCalls[0]!.creds.appId).toBe("12345");
    expect(savedCredentialsCalls[0]!.creds.slug).toBe("almirant-test");
    expect(savedCredentialsCalls[0]!.userId).toBe("admin-user-id");

    expect(deletedStates).toContain("valid-state-12345");
  });

  it("on success with returnTo=/settings/github: redirects without step=github", async () => {
    storedState = {
      state: "valid-state-12345",
      appName: "My App",
      returnTo: "/settings/github",
      expiresAt: new Date(Date.now() + 60_000),
    };

    const response = await app.handle(
      new Request(
        "http://localhost/instance/github-app/manifest-callback?code=abc&state=valid-state-12345",
      ),
    );

    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe(
      "https://test.almirant.example.com/settings/github?success=1",
    );
  });

  it("on github fetch failure (502): returns 502, does not save credentials", async () => {
    fetchResponse = { ok: false, status: 422, body: { message: "Bad code" } };

    const response = await app.handle(
      new Request(
        "http://localhost/instance/github-app/manifest-callback?code=bad&state=valid-state-12345",
      ),
    );

    expect(response.status).toBe(502);
    expect(savedCredentialsCalls).toHaveLength(0);
  });

  it("emits posthog event github_app.manifest.callback.success on success", async () => {
    await app.handle(
      new Request(
        "http://localhost/instance/github-app/manifest-callback?code=abc&state=valid-state-12345",
      ),
    );

    const evt = captureEventCalls.find(
      (c) => c.event === "github_app.manifest.callback.success",
    );
    expect(evt).toBeDefined();
    expect(evt!.properties?.app_slug).toBe("almirant-test");
  });

  it("emits posthog event github_app.manifest.callback.failed on github error", async () => {
    fetchResponse = { ok: false, status: 422, body: {} };

    await app.handle(
      new Request(
        "http://localhost/instance/github-app/manifest-callback?code=bad&state=valid-state-12345",
      ),
    );

    const evt = captureEventCalls.find(
      (c) => c.event === "github_app.manifest.callback.failed",
    );
    expect(evt).toBeDefined();
    expect(evt!.properties?.error_code).toBe(422);
  });
});

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
import * as manifestStatesRepoActual from "@almirant/database";
import * as posthogActual from "../../../../shared/services/posthog-service";

// Capture real implementations to restore in afterAll (mock.module leaks
// across test files — see feedback_bun_mock_module_leak).
const realGetInstanceConfig = instanceConfigActual.getInstanceConfig;
const realCreateManifestState = manifestStatesRepoActual.createManifestState;
const realCaptureServerEvent = posthogActual.captureServerEvent;

let createManifestStateCalls: Array<{
  state: string;
  appName: string;
  returnTo: string | null;
  expiresAt: Date;
  createdByUserId: string | null;
}> = [];

let captureEventCalls: Array<{
  distinctId: string;
  event: string;
  properties: Record<string, unknown> | undefined;
}> = [];

let publicUrl: string | null = "https://test.almirant.example.com";

mock.module("../../services/instance-config-service", () => ({
  ...instanceConfigActual,
  getInstanceConfig: async () => ({
    publicUrl,
    githubAppSlug: null,
    githubAppId: null,
    onboardingCompletedAt: null,
    skippedOnboardingSteps: [],
  }),
}));

mock.module("@almirant/database", () => ({
  ...manifestStatesRepoActual,
  createManifestState: async (data: {
    state: string;
    appName: string;
    returnTo: string | null;
    expiresAt: Date;
    createdByUserId: string | null;
  }) => {
    createManifestStateCalls.push(data);
    return { id: "test-id", createdAt: new Date(), ...data };
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

interface ManifestResponse {
  success: boolean;
  data?: {
    manifest: {
      name: string;
      url: string;
      hook_attributes: { url: string };
      setup_url: string;
      redirect_url: string;
      callback_urls: string[];
      public: boolean;
      default_permissions: Record<string, string>;
      default_events: string[];
    };
    state: string;
  };
  error?: string;
}

describe("GET /instance/github-app/manifest", () => {
  let app: Elysia<any, any, any, any, any, any, any>;

  beforeAll(async () => {
    const { githubAppRoutes } = await import("../github-app.routes");
    app = new Elysia()
      .derive(() => ({ user: { id: "admin-user-id", role: "admin" } }))
      .use(githubAppRoutes) as unknown as typeof app;
  });

  beforeEach(() => {
    createManifestStateCalls = [];
    captureEventCalls = [];
    publicUrl = "https://test.almirant.example.com";
  });

  afterAll(() => {
    mock.module("../../services/instance-config-service", () => ({
      ...instanceConfigActual,
      getInstanceConfig: realGetInstanceConfig,
    }));
    mock.module("@almirant/database", () => ({
      ...manifestStatesRepoActual,
      createManifestState: realCreateManifestState,
    }));
    mock.module("../../../../shared/services/posthog-service", () => ({
      ...posthogActual,
      captureServerEvent: realCaptureServerEvent,
    }));
  });

  it("returns 422 when appName is missing", async () => {
    const response = await app.handle(
      new Request(
        "http://localhost/instance/github-app/manifest?state=test-state-12345",
      ),
    );
    expect(response.status).toBe(422);
  });

  it("returns 422 when appName is whitespace-only", async () => {
    const response = await app.handle(
      new Request(
        "http://localhost/instance/github-app/manifest?state=test-state-12345&appName=%20%20%20",
      ),
    );
    expect(response.status).toBe(422);
  });

  it("returns 400 when state is shorter than 8 chars", async () => {
    const response = await app.handle(
      new Request(
        "http://localhost/instance/github-app/manifest?state=short&appName=My%20App",
      ),
    );
    expect(response.status).toBe(400);
  });

  it("returns 400 when publicUrl is not configured", async () => {
    publicUrl = null;
    const response = await app.handle(
      new Request(
        "http://localhost/instance/github-app/manifest?state=test-state-12345&appName=My%20App",
      ),
    );
    expect(response.status).toBe(400);
  });

  it("returns manifest with correct webhook URL (/webhooks/github, not /api/github/webhook)", async () => {
    const response = await app.handle(
      new Request(
        "http://localhost/instance/github-app/manifest?state=test-state-12345&appName=My%20App",
      ),
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as ManifestResponse;
    expect(body.success).toBe(true);
    expect(body.data!.manifest.hook_attributes.url).toBe(
      "https://test.almirant.example.com/webhooks/github",
    );
  });

  it("returns manifest with setup_url pointing to /settings/github/callback", async () => {
    const response = await app.handle(
      new Request(
        "http://localhost/instance/github-app/manifest?state=test-state-12345&appName=My%20App",
      ),
    );
    const body = (await response.json()) as ManifestResponse;
    expect(body.data!.manifest.setup_url).toBe(
      "https://test.almirant.example.com/settings/github/callback",
    );
  });

  it("returns manifest with name from appName query (no default 'Almirant')", async () => {
    const response = await app.handle(
      new Request(
        "http://localhost/instance/github-app/manifest?state=test-state-12345&appName=Almirant%20-%20mi-instancia",
      ),
    );
    const body = (await response.json()) as ManifestResponse;
    expect(body.data!.manifest.name).toBe("Almirant - mi-instancia");
  });

  it("persists state row in DB with appName and returnTo", async () => {
    await app.handle(
      new Request(
        "http://localhost/instance/github-app/manifest?state=test-state-12345&appName=My%20App&returnTo=%2Fsettings%2Fgithub",
      ),
    );

    expect(createManifestStateCalls).toHaveLength(1);
    expect(createManifestStateCalls[0]!.state).toBe("test-state-12345");
    expect(createManifestStateCalls[0]!.appName).toBe("My App");
    expect(createManifestStateCalls[0]!.returnTo).toBe("/settings/github");
    expect(createManifestStateCalls[0]!.createdByUserId).toBe("admin-user-id");
    expect(createManifestStateCalls[0]!.expiresAt.getTime()).toBeGreaterThan(
      Date.now(),
    );
  });

  it("ignores returnTo not in allowlist (falls back to /onboarding)", async () => {
    await app.handle(
      new Request(
        "http://localhost/instance/github-app/manifest?state=test-state-12345&appName=My%20App&returnTo=%2Fevil%2Fpath",
      ),
    );

    expect(createManifestStateCalls).toHaveLength(1);
    expect(createManifestStateCalls[0]!.returnTo).toBe("/onboarding");
  });

  it("emits posthog event github_app.manifest.requested", async () => {
    await app.handle(
      new Request(
        "http://localhost/instance/github-app/manifest?state=test-state-12345&appName=My%20App&returnTo=%2Fsettings%2Fgithub",
      ),
    );

    const requested = captureEventCalls.find(
      (c) => c.event === "github_app.manifest.requested",
    );
    expect(requested).toBeDefined();
    expect(requested!.distinctId).toBe("admin-user-id");
    expect(requested!.properties?.app_name).toBe("My App");
    expect(requested!.properties?.return_to).toBe("/settings/github");
  });
});

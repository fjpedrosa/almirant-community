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

// ---------------------------------------------------------------------------
// GET /onboarding/status — GitHub step "done" + "appSlug" must reflect the App
// configured by ANY source. Cloud configures the central App via env vars, so
// instance_settings (populated only by the self-hosted create flow) is NULL
// there. The status must fall back to getGithubAppStatus() so the frontend
// renders the INSTALL block instead of a dead "create" header.
// ---------------------------------------------------------------------------

// Capture reals to restore in afterAll (mock.module leaks across files — see
// feedback_bun_mock_module_leak).
const realGetInstanceConfig = instanceConfigActual.getInstanceConfig;
const realGetGithubAppStatus = credentialsServiceActual.getGithubAppStatus;

type InstanceConfigShape = {
  publicUrl: string | null;
  githubAppSlug: string | null;
  githubAppId: string | null;
  onboardingCompletedAt: Date | null;
  onboardingSkippedSteps: string[];
};

type GithubStatusShape = {
  configured: boolean;
  source: "db" | "env" | null;
  slug: string | null;
  appName: string | null;
};

let instanceConfig: InstanceConfigShape;
let githubStatus: GithubStatusShape;
let userCount = 1;

mock.module("../../services/instance-config-service", () => ({
  ...instanceConfigActual,
  getInstanceConfig: async () => instanceConfig,
}));

mock.module("../../services/github-app-credentials-service", () => ({
  ...credentialsServiceActual,
  getGithubAppStatus: async () => githubStatus,
}));

mock.module("@almirant/database", () => ({
  ...databaseActual,
  db: {
    select: () => ({
      from: async () => [{ value: userCount }],
    }),
  },
}));

interface StatusResponse {
  success: boolean;
  data?: {
    admin: { done: boolean; userCount: number };
    tailscale: { done: boolean; skipped: boolean; publicUrl: string | null };
    github: { done: boolean; skipped: boolean; appSlug: string | null };
    completedAt: string | null;
  };
}

const getStatus = async (app: {
  handle: (req: Request) => Promise<Response>;
}): Promise<StatusResponse> => {
  const response = await app.handle(
    new Request("http://localhost/onboarding/status"),
  );
  expect(response.status).toBe(200);
  return (await response.json()) as StatusResponse;
};

describe("GET /instance/onboarding/status — GitHub step", () => {
  let app: Elysia<any, any, any, any, any, any, any>;

  beforeAll(async () => {
    const { instanceOnboardingRoutes } = await import(
      "../instance-onboarding.routes"
    );
    app = new Elysia()
      .derive(() => ({ user: { id: "admin-user-id", role: "admin" } }))
      .use(instanceOnboardingRoutes) as unknown as typeof app;
  });

  beforeEach(() => {
    userCount = 1;
    instanceConfig = {
      publicUrl: "https://cloud.almirant.ai",
      githubAppSlug: null,
      githubAppId: null,
      onboardingCompletedAt: null,
      onboardingSkippedSteps: [],
    };
    githubStatus = {
      configured: false,
      source: null,
      slug: null,
      appName: null,
    };
  });

  afterAll(() => {
    mock.module("../../services/instance-config-service", () => ({
      ...instanceConfigActual,
      getInstanceConfig: realGetInstanceConfig,
    }));
    mock.module("../../services/github-app-credentials-service", () => ({
      ...credentialsServiceActual,
      getGithubAppStatus: realGetGithubAppStatus,
    }));
    mock.module("@almirant/database", () => ({ ...databaseActual }));
  });

  it("cloud: App configured via env (instance_settings NULL) → done + resolved slug", async () => {
    // instance_settings is empty (self-hosted create flow never ran)...
    instanceConfig.githubAppId = null;
    instanceConfig.githubAppSlug = null;
    // ...but the central App is present via env with a resolved slug.
    githubStatus = {
      configured: true,
      source: "env",
      slug: "almirant-app",
      appName: null,
    };

    const body = await getStatus(app);

    expect(body.data!.github.done).toBe(true);
    expect(body.data!.github.appSlug).toBe("almirant-app");
  });

  it("self-hosted: instance_settings populated → done + its slug (no regression)", async () => {
    instanceConfig.githubAppId = "123456";
    instanceConfig.githubAppSlug = "my-self-hosted-app";
    githubStatus = {
      configured: true,
      source: "db",
      slug: "my-self-hosted-app",
      appName: null,
    };

    const body = await getStatus(app);

    expect(body.data!.github.done).toBe(true);
    expect(body.data!.github.appSlug).toBe("my-self-hosted-app");
  });

  it("unconfigured: no App anywhere → not done, no slug", async () => {
    const body = await getStatus(app);

    expect(body.data!.github.done).toBe(false);
    expect(body.data!.github.appSlug).toBeNull();
  });
});

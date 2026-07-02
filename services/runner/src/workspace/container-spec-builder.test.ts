import { describe, expect, it } from "bun:test";
import type { ClaimedJob, OpenCodeConfig } from "@almirant/remote-agent";
import { buildContainerSpec } from "./container-spec-builder";

const createJob = (overrides: Partial<ClaimedJob> = {}): ClaimedJob => ({
  id: "job-1",
  workItemId: null,
  projectId: null,
  boardId: null,
  createdByUserId: null,
  workspaceId: null,
  jobType: "implementation",
  provider: "zipu",
  priority: "medium",
  status: "queued",
  retryCount: 0,
  maxRetries: 0,
  availableAt: null,
  config: { skillName: "runner-implement" },
  ...overrides,
});

describe("buildContainerSpec", () => {
  it("uses the persisted RAM forecast plus provider bump as the container limit", () => {
    const spec = buildContainerSpec({
      job: createJob({
        config: {
          skillName: "runner-implement",
          resourceEstimate: {
            estimatedMemoryMb: 3584,
            source: "forecast",
            confidence: "low",
          },
        },
      }),
      workItem: null,
      runtimeConfig: {
        type: "claude-shim",
        image: "almirant-runner:test",
        envVars: {},
      },
      injectedEnv: {},
      openCodeConfig: {} as never,
      workspaceMountMode: "bind",
      reposHostPath: "/repos",
    });

    expect(spec.memoryLimitMb).toBe(4096);
  });

  it("injects the generated OpenCode config JSON into OpenCode containers", () => {
    const openCodeConfig: OpenCodeConfig = {
      $schema: "https://opencode.ai/config.json",
      instructions: ["AGENTS.md"],
      model: "glm-5.1",
      provider: {
        "zai-coding-plan": {
          options: {
            apiKey: "{env:ZAI_API_KEY}",
            endpoint: "https://api.z.ai/api/coding/paas/v4",
          },
        },
      },
      permission: "allow",
      agent: {
        build: {
          permission: {
            edit: "allow",
            bash: "allow",
          },
        },
      },
      mcp: {},
      watcher: {
        ignore: ["node_modules/**"],
      },
    };

    const spec = buildContainerSpec({
      job: createJob(),
      workItem: null,
      runtimeConfig: {
        type: "opencode",
        image: "almirant-opencode-shim:test",
        envVars: {
          OPENCODE_HOSTNAME: "0.0.0.0",
          OPENCODE_PORT: "4096",
        },
        configFile: "opencode.json",
      },
      injectedEnv: {
        ZAI_API_KEY: "zai-api-key",
      },
      openCodeConfig,
      workspaceMountMode: "bind",
      reposHostPath: "/repos",
    });

    expect(spec.env.OPENCODE_START_MODE).toBe("serve");
    expect(spec.env.OPENCODE_CONFIG_JSON).toBe(JSON.stringify(openCodeConfig));
    expect(JSON.parse(spec.env.OPENCODE_CONFIG_JSON)).toMatchObject({
      permission: "allow",
      agent: {
        build: {
          permission: {
            edit: "allow",
            bash: "allow",
          },
        },
      },
    });
  });

  it("does not inject opencode.json for non-OpenCode runtimes", () => {
    const spec = buildContainerSpec({
      job: createJob(),
      workItem: null,
      runtimeConfig: {
        type: "claude-shim",
        image: "almirant-claude-shim:test",
        envVars: {},
      },
      injectedEnv: {},
      openCodeConfig: {
        mcp: {},
      } as never,
      workspaceMountMode: "bind",
      reposHostPath: "/repos",
    });

    expect(spec.env.OPENCODE_CONFIG_JSON).toBe("");
  });

  it("enables browser runtime and reserves heavy memory for browser jobs", () => {
    const spec = buildContainerSpec({
      job: createJob({
        promptTemplate: "runner-fix-dod",
        config: {
          skillName: "runner-fix-dod",
          needsBrowser: true,
        },
      }),
      workItem: null,
      runtimeConfig: {
        type: "claude-shim",
        image: "almirant-claude-shim:test",
        envVars: {},
      },
      injectedEnv: {},
      openCodeConfig: {
        mcp: {},
      } as never,
      workspaceMountMode: "bind",
      reposHostPath: "/repos",
    });

    expect(spec.env.ENABLE_BROWSER).toBe("true");
    expect(spec.memoryLimitMb).toBeGreaterThanOrEqual(3584);
  });
});

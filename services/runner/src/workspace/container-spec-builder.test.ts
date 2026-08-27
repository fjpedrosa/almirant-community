import { describe, expect, it } from "bun:test";
import type { ClaimedJob, OpenCodeConfig } from "@almirant/remote-agent";
import { DEFAULT_MEMORY_MB } from "@almirant/shared";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
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
  it("does not inject a custom author into ordinary job containers", () => {
    const spec = buildContainerSpec({
      job: createJob(),
      workItem: null,
      runtimeConfig: { type: "claude-shim", image: "shim:test", envVars: {} },
      injectedEnv: {},
      openCodeConfig: { mcp: {} } as never,
      workspaceMountMode: "bind",
      reposHostPath: "/repos",
    });

    expect(spec.env.ALMIRANT_GIT_AUTHOR_NAME).toBeUndefined();
    expect(spec.env.ALMIRANT_GIT_AUTHOR_EMAIL).toBeUndefined();
  });

  it.each([
    "ALMIRANT_GIT_AUTHOR_NAME",
    "ALMIRANT_GIT_AUTHOR_EMAIL",
    "GIT_AUTHOR_NAME",
    "GIT_AUTHOR_EMAIL",
    "GIT_COMMITTER_NAME",
    "GIT_COMMITTER_EMAIL",
    "GIT_CONFIG",
    "GIT_CONFIG_COUNT",
    "GIT_CONFIG_KEY_0",
    "GIT_CONFIG_VALUE_0",
    "GIT_CONFIG_PARAMETERS",
    "GIT_CONFIG_GLOBAL",
    "GIT_CONFIG_SYSTEM",
    "GIT_CONFIG_NOSYSTEM",
    "GIT_CONFIG_ARBITRARY_FUTURE_KEY",
    "XDG_CONFIG_HOME",
  ])("fails closed when caller-controlled environment tries to override %s", (key) => {
    for (const source of ["injected", "runtime"] as const) {
      expect(() => buildContainerSpec({
        job: createJob(),
        workItem: null,
        runtimeConfig: {
          type: "claude-shim",
          image: "shim:test",
          envVars: source === "runtime" ? { [key]: "Untrusted Author" } : {},
        },
        injectedEnv: source === "injected" ? { [key]: "Untrusted Author" } : {},
        openCodeConfig: { mcp: {} } as never,
        workspaceMountMode: "bind",
        reposHostPath: "/repos",
      })).toThrow("Git author environment override is restricted");
    }
  });

  it("rejects the real Git config-count author bypass before container start", async () => {
    const root = await mkdtemp(join(tmpdir(), "almirant-git-config-bypass-"));
    const repo = join(root, "repo");
    const home = join(root, "home");
    const bypassEnv = {
      GIT_CONFIG_COUNT: "2",
      GIT_CONFIG_KEY_0: "user.name",
      GIT_CONFIG_VALUE_0: "Attacker",
      GIT_CONFIG_KEY_1: "user.email",
      GIT_CONFIG_VALUE_1: "attacker@example.com",
    };
    const runGit = async (args: string[], env: Record<string, string> = {}) => {
      const process = Bun.spawn(["git", ...args], {
        cwd: repo,
        env: { ...Bun.env, HOME: home, ...env },
        stdout: "pipe",
        stderr: "pipe",
      });
      const [stdout, stderr, exitCode] = await Promise.all([
        new Response(process.stdout).text(),
        new Response(process.stderr).text(),
        process.exited,
      ]);
      if (exitCode !== 0) throw new Error(stderr || stdout || `git ${args[0]} failed`);
      return stdout;
    };

    try {
      await mkdir(repo, { recursive: true });
      await mkdir(home, { recursive: true });
      await runGit(["init", "-b", "main"]);
      await runGit(["config", "--global", "user.name", "Trusted Server Author"]);
      await runGit(["config", "--global", "user.email", "trusted@example.com"]);
      await writeFile(join(repo, "proof.txt"), "proof\n");
      await runGit(["add", "proof.txt"]);
      await runGit(["commit", "-m", "proof"], bypassEnv);
      const actualAuthor = await runGit(["log", "-1", "--format=%an <%ae>"]);
      expect(actualAuthor.trim()).toBe("Attacker <attacker@example.com>");

      expect(() => buildContainerSpec({
        job: createJob(),
        workItem: null,
        runtimeConfig: {
          type: "claude-shim",
          image: "shim:test",
          envVars: bypassEnv,
        },
        injectedEnv: {},
        openCodeConfig: { mcp: {} } as never,
        workspaceMountMode: "bind",
        reposHostPath: "/repos",
      })).toThrow("Git author environment override is restricted");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("starts disconnected and routes all agent egress through the allowlisted proxy", () => {
    const spec = buildContainerSpec({
      job: createJob(),
      workItem: null,
      runtimeConfig: {
        type: "claude-shim",
        image: "shim:test",
        envVars: { HTTPS_PROXY: "http://runner-internal:8080", NO_PROXY: "*" },
      },
      injectedEnv: {
        HTTP_PROXY: "http://docker-proxy:2375",
        ALL_PROXY: "socks5://runner-internal:1080",
      },
      openCodeConfig: { mcp: {} } as never,
      workspaceMountMode: "bind",
      reposHostPath: "/repos",
      egressProxyUrl: "http://egress-proxy:3128",
    });

    expect(spec.networkMode).toBe("none");
    expect(spec.env).toMatchObject({
      HTTP_PROXY: "http://egress-proxy:3128",
      HTTPS_PROXY: "http://egress-proxy:3128",
      NO_PROXY: "127.0.0.1,localhost,::1",
    });
    expect(spec.env.ALL_PROXY).toBeUndefined();
    expect(spec.dnsServers).toEqual(["127.0.0.1"]);
    expect(spec.env.NO_PROXY).not.toContain("docker-proxy");
    expect(spec.env.NO_PROXY).not.toContain("runner-internal");
  });

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

  it("applies provider bumps to the persisted shared memory default", () => {
    expect(DEFAULT_MEMORY_MB).toBe(2048);

    for (const [runtimeType, expectedMemoryMb] of [
      ["claude-shim", 2560],
      ["codex-shim", 3584],
    ] as const) {
      const spec = buildContainerSpec({
        job: createJob({
          config: {
            skillName: "unknown-skill",
            resourceEstimate: {
              estimatedMemoryMb: DEFAULT_MEMORY_MB,
              source: "skill-default",
              confidence: "low",
            },
          },
        }),
        workItem: null,
        runtimeConfig: {
          type: runtimeType,
          image: "almirant-runner:test",
          envVars: {},
        },
        injectedEnv: {},
        openCodeConfig: {} as never,
        workspaceMountMode: "bind",
        reposHostPath: "/repos",
      });

      expect(spec.memoryLimitMb).toBe(expectedMemoryMb);
    }
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

  it("builds the exact sterile Pi environment from runner-owned values", () => {
    const spec = buildContainerSpec({
      job: createJob({ provider: "pi", codingAgent: "pi" }),
      workItem: null,
      runtimeConfig: {
        type: "pi-shim",
        image: "almirant-pi-shim:test",
        envVars: {
          SHIM_SERVER_HOST: "0.0.0.0",
          SHIM_SERVER_PORT: "4096",
          PATH: "/usr/local/bin:/usr/bin:/bin",
          SSL_CERT_FILE: "/etc/ssl/certs/ca-certificates.crt",
          SSL_CERT_DIR: "/etc/ssl/certs",
          NODE_EXTRA_CA_CERTS: "/etc/ssl/certs/runner-proxy-ca.pem",
          HOME: "/hostile/runtime-home",
          NODE_OPTIONS: "--require=/hostile/runtime-preload.cjs",
          OPENAI_API_KEY: "hostile-runtime-openai-key",
          AWS_SECRET_ACCESS_KEY: "hostile-runtime-aws-secret",
        },
      },
      injectedEnv: {
        ZAI_API_KEY: "zai-selected-key",
        PI_PROVIDER: "zai",
        PI_MODEL: "glm-5.3",
        PI_THINKING_LEVEL: "high",
        ALMIRANT_PROVIDER: "zai",
        ALMIRANT_CODING_AGENT: "pi",
        REASONING_BUDGET: "hostile-duplicate-thinking",
        PROVIDER_SECRET: "hostile-provider-secret",
        OPENAI_API_KEY: "hostile-openai-key",
        AWS_ACCESS_KEY_ID: "hostile-aws-key",
        GITHUB_TOKEN: "hostile-github-token",
        __GIT_CLONE_TOKEN: "hostile-clone-token",
        HOME: "/hostile/job-home",
        NODE_OPTIONS: "--import=/hostile/job-preload.mjs",
        NODE_TLS_REJECT_UNAUTHORIZED: "0",
      },
      openCodeConfig: { mcp: {} } as never,
      workspaceMountMode: "bind",
      reposHostPath: "/repos",
      egressProxyUrl: "http://egress-proxy:3128",
    });

    expect(Object.keys(spec.env).sort()).toEqual([
      "HOME",
      "HTTPS_PROXY",
      "HTTP_PROXY",
      "NODE_EXTRA_CA_CERTS",
      "NO_PROXY",
      "PATH",
      "PI_CODING_AGENT_DIR",
      "PI_MODEL",
      "PI_OFFLINE",
      "PI_PROVIDER",
      "PI_SKIP_VERSION_CHECK",
      "PI_TELEMETRY",
      "PI_THINKING_LEVEL",
      "SHIM_SERVER_HOST",
      "SHIM_SERVER_PORT",
      "SSL_CERT_DIR",
      "SSL_CERT_FILE",
      "TEMP",
      "TMP",
      "TMPDIR",
      "WORKSPACE_REPO_PATH",
      "ZAI_API_KEY",
      "http_proxy",
      "https_proxy",
      "no_proxy",
    ]);
    expect(spec.env).toMatchObject({
      HOME: "/home/opencode",
      PATH: "/usr/local/bin:/usr/bin:/bin",
      TMPDIR: "/tmp",
      TMP: "/tmp",
      TEMP: "/tmp",
      SHIM_SERVER_HOST: "0.0.0.0",
      SHIM_SERVER_PORT: "4096",
      WORKSPACE_REPO_PATH: "/workspace/repo",
      PI_CODING_AGENT_DIR: "/tmp/almirant-pi-agent",
      PI_PROVIDER: "zai",
      PI_MODEL: "glm-5.3",
      PI_THINKING_LEVEL: "high",
      PI_OFFLINE: "1",
      PI_TELEMETRY: "0",
      PI_SKIP_VERSION_CHECK: "1",
      ZAI_API_KEY: "zai-selected-key",
      HTTP_PROXY: "http://egress-proxy:3128",
      HTTPS_PROXY: "http://egress-proxy:3128",
      NO_PROXY: "127.0.0.1,localhost,::1",
      SSL_CERT_FILE: "/etc/ssl/certs/ca-certificates.crt",
      SSL_CERT_DIR: "/etc/ssl/certs",
      NODE_EXTRA_CA_CERTS: "/etc/ssl/certs/runner-proxy-ca.pem",
    });
    expect(spec.user).toBe("1001:1001");
    expect(spec.networkMode).toBe("none");
    expect(spec.readOnlyRootFs).toBe(true);
    expect(spec.capDrop).toEqual(["ALL"]);
    expect(spec.securityOpt).toEqual(["no-new-privileges:true"]);
  });

  it("rejects every Pi MCP artifact before returning a container spec", () => {
    const baseParams = {
      job: createJob({ provider: "pi", codingAgent: "pi" }),
      workItem: null,
      runtimeConfig: {
        type: "pi-shim" as const,
        image: "almirant-pi-shim:test",
        envVars: { SHIM_SERVER_HOST: "0.0.0.0", SHIM_SERVER_PORT: "4096" },
      },
      injectedEnv: {
        ZAI_API_KEY: "zai-selected-key",
        PI_PROVIDER: "zai",
        PI_MODEL: "glm-5.3",
      },
      openCodeConfig: { mcp: {} } as never,
      workspaceMountMode: "bind" as const,
      reposHostPath: "/repos",
    };
    const attempts = [
      {
        ...baseParams,
        openCodeConfig: {
          mcp: {
            context7: {
              type: "remote",
              url: "https://mcp.context7.com/mcp",
              enabled: true,
            },
          },
        } as never,
      },
      {
        ...baseParams,
        injectedEnv: { ...baseParams.injectedEnv, MCP_CONFIG_JSON: "{}" },
      },
      {
        ...baseParams,
        runtimeConfig: {
          ...baseParams.runtimeConfig,
          envVars: {
            ...baseParams.runtimeConfig.envVars,
            MCP_TOKEN_PRIVATE_DOCS: "must-not-reach-pi",
          },
        },
      },
    ];

    for (const attempt of attempts) {
      expect(() => buildContainerSpec(attempt)).toThrow(
        "Pi runtime does not permit MCP materialization",
      );
    }
  });

  it("fails closed for non-canonical Pi provider and credential values", () => {
    const build = (injectedEnv: Record<string, string>) => buildContainerSpec({
      job: createJob({ provider: "pi", codingAgent: "pi" }),
      workItem: null,
      runtimeConfig: {
        type: "pi-shim",
        image: "almirant-pi-shim:test",
        envVars: {},
      },
      injectedEnv,
      openCodeConfig: { mcp: {} } as never,
      workspaceMountMode: "bind",
      reposHostPath: "/repos",
    });

    expect(() => build({
      ZAI_API_KEY: "key",
      PI_PROVIDER: "openai",
      PI_MODEL: "glm-5.3",
    })).toThrow("admitted Z.AI provider");
    expect(() => build({
      ZAI_API_KEY: " key ",
      PI_PROVIDER: "zai",
      PI_MODEL: "glm-5.3",
    })).toThrow("exact runner-owned ZAI_API_KEY");
  });

  it("injects no MCP servers into a read-only visual judge container", () => {
    const spec = buildContainerSpec({
      job: createJob({
        provider: "claude-code",
        codingAgent: "claude-code",
        config: {
          siteBuildStage: "visual_judge",
          workspaceIntent: "read-only",
          postSessionPushPolicy: "never",
          needsBrowser: false,
        },
      }),
      workItem: null,
      runtimeConfig: {
        type: "claude-shim",
        image: "almirant-claude-shim:test",
        envVars: {},
      },
      injectedEnv: {
        ALMIRANT_CLAUDE_TOOL_POLICY: "read-only",
        CLAUDE_CODE_SAFE_MODE: "1",
      },
      openCodeConfig: {
        mcp: {},
      } as never,
      workspaceMountMode: "bind",
      reposHostPath: "/repos",
    });

    expect(spec.env.MCP_CONFIG_JSON).toBe("");
    expect(spec.env.CLAUDE_MCP_JSON).toBe("");
    expect(spec.env.CODEX_MCP_JSON).toBe("");
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

describe("buildContainerSpec workspace mount modes", () => {
  const buildSpecForMode = (workspaceMountMode: "bind" | "tmpfs" | "volume") =>
    buildContainerSpec({
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
      workspaceMountMode,
      reposHostPath: "/repos",
    });

  it("emits logical volumes without host paths in volume mode", () => {
    const spec = buildSpecForMode("volume");

    expect(spec.volumes).toEqual([
      { source: "workspace", target: "/workspace" },
      { source: "tmp", target: "/tmp" },
      { source: "home", target: "/home/opencode" },
    ]);
    expect(spec.tmpfs).toEqual({});
  });

  it("treats volume mode as disk-backed for the memory limit (no tmpfs tax)", () => {
    const bindSpec = buildSpecForMode("bind");
    const volumeSpec = buildSpecForMode("volume");
    const tmpfsSpec = buildSpecForMode("tmpfs");

    expect(volumeSpec.memoryLimitMb).toBe(bindSpec.memoryLimitMb!);
    expect(tmpfsSpec.memoryLimitMb!).toBeGreaterThan(volumeSpec.memoryLimitMb!);
  });

  it("keeps the default bind behavior unchanged (host-path binds, no tmpfs)", () => {
    const spec = buildSpecForMode("bind");

    expect(spec.volumes).toEqual([
      { source: "/repos/job-1", target: "/workspace" },
      { source: "/repos/job-1/.tmp", target: "/tmp" },
      { source: "/repos/job-1/.home", target: "/home/opencode" },
    ]);
    expect(spec.tmpfs).toEqual({});
  });
});

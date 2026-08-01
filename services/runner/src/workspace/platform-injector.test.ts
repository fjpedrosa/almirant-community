import { afterEach, describe, expect, it } from "bun:test";
import { mkdtemp, mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import type { ContainerManager } from "./container-manager";
import { createPlatformInjector } from "./platform-injector";

const PLATFORM_CONFIG_PATH = join(import.meta.dir, "..", "..", "platform-config");
const TEST_PLATFORM_ASSET_PATH = ".claude/skills/platform-test/SKILL.md";
const TEST_PLATFORM_ASSET_CONTENT = "# Platform test skill\n";
const TEST_PLATFORM_CLAUDE = "# Test Claude instructions\n";
const TEST_PLATFORM_AGENTS = "# Test agent instructions\n";
const RUNTIME_OWNED_CLAUDE_SETTINGS = new Set([
  ".claude/settings.json",
  ".claude/settings.local.json",
]);

const tempDirs: string[] = [];

const createTempWorkspace = async () => {
  const root = await mkdtemp(join(tmpdir(), "platform-injector-"));
  tempDirs.push(root);
  const workspacePath = join(root, "workspace");
  await mkdir(join(workspacePath, ".git", "info"), { recursive: true });
  return { root, workspacePath };
};

const writeTestPlatformAsset = async (platformConfigPath: string): Promise<void> => {
  const assetPath = join(platformConfigPath, TEST_PLATFORM_ASSET_PATH);
  await mkdir(dirname(assetPath), { recursive: true });
  await writeFile(assetPath, TEST_PLATFORM_ASSET_CONTENT);
};

const createPlatformConfigFixture = async (root: string): Promise<string> => {
  const platformConfigPath = join(root, "platform-config-fixture");
  await writeTestPlatformAsset(platformConfigPath);
  await writeFile(join(platformConfigPath, "CLAUDE.md.platform"), TEST_PLATFORM_CLAUDE);
  await writeFile(join(platformConfigPath, "AGENTS.md.platform"), TEST_PLATFORM_AGENTS);
  return platformConfigPath;
};

const listRelativeFiles = async (
  root: string,
  relativeDirectory = "",
): Promise<string[]> => {
  const entries = await readdir(join(root, relativeDirectory), { withFileTypes: true });
  const files = await Promise.all(
    entries.map(async (entry) => {
      const relativePath = relativeDirectory
        ? `${relativeDirectory}/${entry.name}`
        : entry.name;
      return entry.isDirectory()
        ? listRelativeFiles(root, relativePath)
        : [relativePath];
    }),
  );
  return files.flat().sort();
};

type FakeContainerManagerOptions = {
  trackedPaths?: string[];
  failLsFiles?: boolean;
  failUpdateIndex?: boolean;
};

const createFakeContainerManager = (
  options: FakeContainerManagerOptions = {},
): ContainerManager =>
  ({
    async execInContainer(_containerId: string, cmd: string[], workingDir = "/") {
      if (cmd[0] === "cat" && cmd[1]) {
        try {
          return {
            exitCode: 0,
            stdout: await readFile(join(workingDir, cmd[1]), "utf8"),
            stderr: "",
          };
        } catch (error) {
          return {
            exitCode: 1,
            stdout: "",
            stderr: error instanceof Error ? error.message : String(error),
          };
        }
      }

      if (cmd[0] === "git" && cmd[1] === "ls-files") {
        if (options.failLsFiles) {
          return { exitCode: 1, stdout: "", stderr: "ls-files failed" };
        }
        const tracked = new Set(options.trackedPaths ?? []);
        const requestedPaths = cmd.slice(2).filter((path) => tracked.has(path));
        return { exitCode: 0, stdout: requestedPaths.join("\n"), stderr: "" };
      }

      if (cmd[0] === "git" && cmd[1] === "update-index") {
        if (options.failUpdateIndex) {
          return { exitCode: 1, stdout: "", stderr: "update-index failed" };
        }
        return { exitCode: 0, stdout: "", stderr: "" };
      }

      return { exitCode: 1, stdout: "", stderr: `Unsupported command: ${cmd.join(" ")}` };
    },

    async writeFileBufferViaExec(_containerId: string, filePath: string, content: Buffer) {
      await mkdir(dirname(filePath), { recursive: true });
      await writeFile(filePath, content);
    },
  }) as unknown as ContainerManager;

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })),
  );
});

describe("createPlatformInjector", () => {
  it("keeps runtime-owned Claude settings out of the shipping platform config", async () => {
    const shippingFiles = await listRelativeFiles(PLATFORM_CONFIG_PATH);
    const forbiddenFiles = shippingFiles.filter((path) =>
      RUNTIME_OWNED_CLAUDE_SETTINGS.has(path.toLowerCase())
    );

    expect(forbiddenFiles).toEqual([]);
  });

  it("crea CLAUDE.md y copia .claude para claude-code", async () => {
    const { root, workspacePath } = await createTempWorkspace();
    const platformConfigPath = await createPlatformConfigFixture(root);
    const injector = createPlatformInjector({
      platformConfigPath,
    });

    const result = await injector.inject({
      containerId: "container-1",
      workspacePath,
      runtime: "claude-code",
      containerManager: createFakeContainerManager(),
    });

    const injectedClaude = await readFile(join(workspacePath, "CLAUDE.md"), "utf8");
    const injectedAsset = await readFile(
      join(workspacePath, TEST_PLATFORM_ASSET_PATH),
      "utf8",
    );

    expect(injectedClaude).toBe(TEST_PLATFORM_CLAUDE);
    expect(injectedAsset).toBe(TEST_PLATFORM_ASSET_CONTENT);
    expect(result.claudeMdAction).toBe("created");
    expect(result.agentsMdAction).toBe("skipped");
    expect(result.injectedPaths).toEqual([TEST_PLATFORM_ASSET_PATH, "CLAUDE.md"]);
    expect(result.excludedPaths).toEqual([TEST_PLATFORM_ASSET_PATH, "CLAUDE.md"]);
  });

  it("crea AGENTS.md para opencode aunque no haya directorio .agents en platform-config", async () => {
    const { workspacePath } = await createTempWorkspace();
    const injector = createPlatformInjector({
      platformConfigPath: PLATFORM_CONFIG_PATH,
    });

    const result = await injector.inject({
      containerId: "container-2",
      workspacePath,
      runtime: "opencode",
      containerManager: createFakeContainerManager(),
    });

    const injectedAgents = await readFile(join(workspacePath, "AGENTS.md"), "utf8");
    const platformAgents = await readFile(join(PLATFORM_CONFIG_PATH, "AGENTS.md.platform"), "utf8");

    expect(injectedAgents).toBe(platformAgents);
    expect(result.claudeMdAction).toBe("skipped");
    expect(result.agentsMdAction).toBe("created");
    expect(result.injectedPaths).toEqual(["AGENTS.md"]);
    expect(result.excludedPaths).toEqual(["AGENTS.md"]);
  });

  it("expone los agentes de plataforma en .opencode/agents para que OpenCode pueda descubrir subagentes", async () => {
    const { root, workspacePath } = await createTempWorkspace();
    const platformConfigPath = join(root, "platform-config-opencode");
    await mkdir(join(platformConfigPath, ".agents", "agents"), { recursive: true });
    await writeFile(join(platformConfigPath, "AGENTS.md.platform"), "# Runner instructions\n");

    const backendArchitectAgent = [
      "---",
      "description: Backend specialist",
      "mode: all",
      "tools:",
      "  write: true",
      "  edit: true",
      "---",
      "",
      "Body",
      "",
    ].join("\n");
    await writeFile(
      join(platformConfigPath, ".agents", "agents", "backend-architect.md"),
      backendArchitectAgent,
    );

    const injector = createPlatformInjector({
      platformConfigPath,
    });

    const result = await injector.inject({
      containerId: "container-opencode-agents",
      workspacePath,
      runtime: "opencode",
      containerManager: createFakeContainerManager(),
    });

    const injectedAgent = await readFile(
      join(workspacePath, ".opencode", "agents", "backend-architect.md"),
      "utf8",
    );

    expect(injectedAgent).toBe(backendArchitectAgent);
    expect(result.injectedPaths).toContain(".agents/agents/backend-architect.md");
    expect(result.injectedPaths).toContain(".opencode/agents/backend-architect.md");
    expect(result.excludedPaths).toContain(".opencode/agents/backend-architect.md");
  });

  it("appenda CLAUDE.md y AGENTS.md existentes para codex", async () => {
    const { root, workspacePath } = await createTempWorkspace();
    const platformConfigPath = await createPlatformConfigFixture(root);
    await writeFile(join(workspacePath, "CLAUDE.md"), "# Instrucciones previas\n");
    await writeFile(join(workspacePath, "AGENTS.md"), "# Agentes previos\n");

    const injector = createPlatformInjector({
      platformConfigPath,
    });

    const result = await injector.inject({
      containerId: "container-3",
      workspacePath,
      runtime: "codex",
      containerManager: createFakeContainerManager(),
    });

    const injectedClaude = await readFile(join(workspacePath, "CLAUDE.md"), "utf8");
    const injectedAgents = await readFile(join(workspacePath, "AGENTS.md"), "utf8");

    expect(injectedClaude).toBe(`# Instrucciones previas\n\n${TEST_PLATFORM_CLAUDE}`);
    expect(injectedAgents).toBe(`# Agentes previos\n\n${TEST_PLATFORM_AGENTS}`);
    expect(result.claudeMdAction).toBe("appended");
    expect(result.agentsMdAction).toBe("appended");
    expect(result.injectedPaths).toEqual([
      TEST_PLATFORM_ASSET_PATH,
      "CLAUDE.md",
      "AGENTS.md",
    ]);
    expect(result.excludedPaths).toEqual([
      TEST_PLATFORM_ASSET_PATH,
      "CLAUDE.md",
      "AGENTS.md",
    ]);
  });

  it("marca paths trackeados como assume-unchanged y solo excluye los no trackeados", async () => {
    const { root, workspacePath } = await createTempWorkspace();
    const platformConfigPath = await createPlatformConfigFixture(root);
    const injector = createPlatformInjector({
      platformConfigPath,
    });

    const result = await injector.inject({
      containerId: "container-4",
      workspacePath,
      runtime: "codex",
      containerManager: createFakeContainerManager({
        trackedPaths: [TEST_PLATFORM_ASSET_PATH, "CLAUDE.md"],
      }),
    });

    expect(result.trackedPathsAssumedUnchanged).toEqual([
      TEST_PLATFORM_ASSET_PATH,
      "CLAUDE.md",
    ]);
    expect(result.excludedPaths).toEqual(["AGENTS.md"]);
  });

  it("cae back a .git/info/exclude cuando git update-index falla", async () => {
    const { root, workspacePath } = await createTempWorkspace();
    const platformConfigPath = await createPlatformConfigFixture(root);
    const injector = createPlatformInjector({
      platformConfigPath,
    });

    const result = await injector.inject({
      containerId: "container-5",
      workspacePath,
      runtime: "claude-code",
      containerManager: createFakeContainerManager({
        trackedPaths: [TEST_PLATFORM_ASSET_PATH, "CLAUDE.md"],
        failUpdateIndex: true,
      }),
    });

    expect(result.trackedPathsAssumedUnchanged).toEqual([]);
    expect(result.excludedPaths).toEqual([TEST_PLATFORM_ASSET_PATH, "CLAUDE.md"]);
  });

  it("omite los markdown platform vacíos y deja diagnóstico observable", async () => {
    const { root, workspacePath } = await createTempWorkspace();
    const platformConfigPath = join(root, "platform-config-empty");
    await writeTestPlatformAsset(platformConfigPath);
    await writeFile(join(platformConfigPath, "CLAUDE.md.platform"), "   \n");

    const injector = createPlatformInjector({
      platformConfigPath,
    });

    const result = await injector.inject({
      containerId: "container-6",
      workspacePath,
      runtime: "claude-code",
      containerManager: createFakeContainerManager(),
    });

    expect(result.claudeMdAction).toBe("skipped");
    expect(result.injectedPaths).toEqual([TEST_PLATFORM_ASSET_PATH]);
    expect(result.excludedPaths).toEqual([TEST_PLATFORM_ASSET_PATH]);
  });

  it("elimina el model pin de los agentes Claude inyectados para que hereden el modelo de la sesión", async () => {
    const { root, workspacePath } = await createTempWorkspace();
    const platformConfigPath = join(root, "platform-config-agents");
    await mkdir(join(platformConfigPath, ".claude", "agents"), { recursive: true });
    await writeFile(join(platformConfigPath, "CLAUDE.md.platform"), "# Runner instructions\n");
    await writeFile(
      join(platformConfigPath, ".claude", "agents", "backend-architect.md"),
      [
        "---",
        "name: backend-architect",
        "description: Backend specialist",
        "tools: Read, Write",
        "model: claude-opus-4-5-20251101",
        "---",
        "",
        "Body",
        "",
      ].join("\n"),
    );

    const injector = createPlatformInjector({
      platformConfigPath,
    });

    await injector.inject({
      containerId: "container-7",
      workspacePath,
      runtime: "claude-code",
      containerManager: createFakeContainerManager(),
    });

    const injectedAgent = await readFile(
      join(workspacePath, ".claude", "agents", "backend-architect.md"),
      "utf8",
    );

    expect(injectedAgent).toContain("name: backend-architect");
    expect(injectedAgent).not.toContain("model:");
  });

  it("normaliza agentes OpenCode al formato requerido por Claude Code", async () => {
    const { root, workspacePath } = await createTempWorkspace();
    const platformConfigPath = join(root, "platform-config-opencode-agents");
    await mkdir(join(platformConfigPath, ".claude", "agents"), { recursive: true });
    await writeFile(join(platformConfigPath, "CLAUDE.md.platform"), "# Runner instructions\n");
    await writeFile(
      join(platformConfigPath, ".claude", "agents", "backend-architect.md"),
      [
        "---",
        "description: Backend specialist",
        "mode: all",
        "tools:",
        "  write: true",
        "  edit: true",
        "  bash: true",
        "---",
        "",
        "Body",
        "",
      ].join("\n"),
    );

    const injector = createPlatformInjector({
      platformConfigPath,
    });

    await injector.inject({
      containerId: "container-8",
      workspacePath,
      runtime: "claude-code",
      containerManager: createFakeContainerManager(),
    });

    const injectedAgent = await readFile(
      join(workspacePath, ".claude", "agents", "backend-architect.md"),
      "utf8",
    );

    expect(injectedAgent).toContain("name: backend-architect");
    expect(injectedAgent).toContain("description: Backend specialist");
    expect(injectedAgent).not.toContain("mode:");
    expect(injectedAgent).not.toContain("tools:");
  });
});

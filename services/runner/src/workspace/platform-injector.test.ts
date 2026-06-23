import { afterEach, describe, expect, it } from "bun:test";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import type { ContainerManager } from "./container-manager";
import { createPlatformInjector } from "./platform-injector";

const PLATFORM_CONFIG_PATH = join(import.meta.dir, "..", "..", "platform-config");

const tempDirs: string[] = [];

const createTempWorkspace = async () => {
  const root = await mkdtemp(join(tmpdir(), "platform-injector-"));
  tempDirs.push(root);
  const workspacePath = join(root, "workspace");
  await mkdir(join(workspacePath, ".git", "info"), { recursive: true });
  return { root, workspacePath };
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
  it("crea CLAUDE.md y copia .claude para claude-code", async () => {
    const { workspacePath } = await createTempWorkspace();
    const injector = createPlatformInjector({
      platformConfigPath: PLATFORM_CONFIG_PATH,
    });

    const result = await injector.inject({
      containerId: "container-1",
      workspacePath,
      runtime: "claude-code",
      containerManager: createFakeContainerManager(),
    });

    const injectedClaude = await readFile(join(workspacePath, "CLAUDE.md"), "utf8");
    const platformClaude = await readFile(join(PLATFORM_CONFIG_PATH, "CLAUDE.md.platform"), "utf8");
    const injectedSettings = await readFile(
      join(workspacePath, ".claude", "settings.json"),
      "utf8",
    );
    const platformSettings = await readFile(
      join(PLATFORM_CONFIG_PATH, ".claude", "settings.json"),
      "utf8",
    );

    expect(injectedClaude).toBe(platformClaude);
    expect(injectedSettings).toBe(platformSettings);
    expect(result.claudeMdAction).toBe("created");
    expect(result.agentsMdAction).toBe("skipped");
    expect(result.injectedPaths).toEqual([".claude/settings.json", "CLAUDE.md"]);
    expect(result.excludedPaths).toEqual([".claude/settings.json", "CLAUDE.md"]);
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
    const { workspacePath } = await createTempWorkspace();
    await writeFile(join(workspacePath, "CLAUDE.md"), "# Instrucciones previas\n");
    await writeFile(join(workspacePath, "AGENTS.md"), "# Agentes previos\n");

    const injector = createPlatformInjector({
      platformConfigPath: PLATFORM_CONFIG_PATH,
    });

    const result = await injector.inject({
      containerId: "container-3",
      workspacePath,
      runtime: "codex",
      containerManager: createFakeContainerManager(),
    });

    const platformClaude = await readFile(join(PLATFORM_CONFIG_PATH, "CLAUDE.md.platform"), "utf8");
    const platformAgents = await readFile(join(PLATFORM_CONFIG_PATH, "AGENTS.md.platform"), "utf8");
    const injectedClaude = await readFile(join(workspacePath, "CLAUDE.md"), "utf8");
    const injectedAgents = await readFile(join(workspacePath, "AGENTS.md"), "utf8");

    expect(injectedClaude).toBe(`# Instrucciones previas\n\n${platformClaude}`);
    expect(injectedAgents).toBe(`# Agentes previos\n\n${platformAgents}`);
    expect(result.claudeMdAction).toBe("appended");
    expect(result.agentsMdAction).toBe("appended");
    expect(result.injectedPaths).toEqual([
      ".claude/settings.json",
      "CLAUDE.md",
      "AGENTS.md",
    ]);
    expect(result.excludedPaths).toEqual([
      ".claude/settings.json",
      "CLAUDE.md",
      "AGENTS.md",
    ]);
  });

  it("marca paths trackeados como assume-unchanged y solo excluye los no trackeados", async () => {
    const { workspacePath } = await createTempWorkspace();
    const injector = createPlatformInjector({
      platformConfigPath: PLATFORM_CONFIG_PATH,
    });

    const result = await injector.inject({
      containerId: "container-4",
      workspacePath,
      runtime: "codex",
      containerManager: createFakeContainerManager({
        trackedPaths: [".claude/settings.json", "CLAUDE.md"],
      }),
    });

    expect(result.trackedPathsAssumedUnchanged).toEqual([
      ".claude/settings.json",
      "CLAUDE.md",
    ]);
    expect(result.excludedPaths).toEqual(["AGENTS.md"]);
  });

  it("cae back a .git/info/exclude cuando git update-index falla", async () => {
    const { workspacePath } = await createTempWorkspace();
    const injector = createPlatformInjector({
      platformConfigPath: PLATFORM_CONFIG_PATH,
    });

    const result = await injector.inject({
      containerId: "container-5",
      workspacePath,
      runtime: "claude-code",
      containerManager: createFakeContainerManager({
        trackedPaths: [".claude/settings.json", "CLAUDE.md"],
        failUpdateIndex: true,
      }),
    });

    expect(result.trackedPathsAssumedUnchanged).toEqual([]);
    expect(result.excludedPaths).toEqual([".claude/settings.json", "CLAUDE.md"]);
  });

  it("omite los markdown platform vacíos y deja diagnóstico observable", async () => {
    const { root, workspacePath } = await createTempWorkspace();
    const platformConfigPath = join(root, "platform-config-empty");
    await mkdir(join(platformConfigPath, ".claude"), { recursive: true });
    await writeFile(join(platformConfigPath, ".claude", "settings.json"), '{"permissions":{}}');
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
    expect(result.injectedPaths).toEqual([".claude/settings.json"]);
    expect(result.excludedPaths).toEqual([".claude/settings.json"]);
  });

  it("elimina el model pin de los agentes Claude inyectados para que hereden el modelo de la sesión", async () => {
    const { root, workspacePath } = await createTempWorkspace();
    const platformConfigPath = join(root, "platform-config-agents");
    await mkdir(join(platformConfigPath, ".claude", "agents"), { recursive: true });
    await writeFile(join(platformConfigPath, ".claude", "settings.json"), '{"permissions":{}}');
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
    await writeFile(join(platformConfigPath, ".claude", "settings.json"), '{"permissions":{}}');
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

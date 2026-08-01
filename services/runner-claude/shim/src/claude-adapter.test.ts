import { afterEach, describe, test, expect } from "bun:test";
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  assertClaudeReadOnlyMcpConfig,
  assertClaudeReadOnlyRuntimeSupport,
  buildClaudePrintArgs,
  READ_ONLY_CLAUDE_CONFIG_DIR,
  READ_ONLY_CLAUDE_MCP_CONFIG_PATH,
  resolveClaudeEffortLevel,
  resolveClaudeProcessEnv,
  resolveClaudeToolPermissionArgs,
} from "./claude-adapter.js";

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
  rmSync(READ_ONLY_CLAUDE_MCP_CONFIG_PATH, { force: true });
  rmSync(READ_ONLY_CLAUDE_CONFIG_DIR, { recursive: true, force: true });
});

describe("resolveClaudeToolPermissionArgs", () => {
  test("keeps bypass mode for normal write-capable jobs", () => {
    expect(resolveClaudeToolPermissionArgs(undefined)).toEqual([
      "--dangerously-skip-permissions",
    ]);
  });

  test("uses safe mode, an empty strict MCP config and read-only tools for visual judges", () => {
    const args = resolveClaudeToolPermissionArgs("read-only");

    expect(args).not.toContain("--dangerously-skip-permissions");
    expect(args).toEqual([
      "--safe-mode",
      "--strict-mcp-config",
      "--mcp-config",
      READ_ONLY_CLAUDE_MCP_CONFIG_PATH,
      "--setting-sources",
      "",
      "--tools",
      "Read,Glob,Grep",
      "--no-session-persistence",
      "--no-chrome",
      "--disable-slash-commands",
      "--permission-mode",
      "plan",
      "--allowedTools",
      "Read,Glob,Grep",
      "--disallowedTools",
      "Bash,Edit,Write,NotebookEdit,WebFetch,WebSearch,Task,Agent",
    ]);
  });

  test("forces a safe isolated Claude environment over job-controlled values", () => {
    expect(resolveClaudeProcessEnv("read-only", {
      PATH: "/usr/bin",
      CLAUDE_CODE_SAFE_MODE: "0",
      CLAUDE_CONFIG_DIR: "/workspace/repo/.claude",
    })).toMatchObject({
      PATH: "/usr/bin",
      CLAUDE_CODE_SAFE_MODE: "1",
      CLAUDE_CONFIG_DIR: READ_ONLY_CLAUDE_CONFIG_DIR,
    });
  });

  test("fails closed when the installed Claude runtime lacks safe-mode support", () => {
    expect(() => assertClaudeReadOnlyRuntimeSupport(`
      --strict-mcp-config
      --mcp-config
      --tools
      --no-session-persistence
      --setting-sources
    `)).toThrow(/--safe-mode/);

    expect(() => assertClaudeReadOnlyRuntimeSupport(`
      --safe-mode
      --strict-mcp-config
      --mcp-config
      --setting-sources
      --tools
      --no-session-persistence
      --no-chrome
      --disable-slash-commands
      --permission-mode
      --allowedTools
      --disallowedTools
    `)).not.toThrow();
  });

  test("fails closed unless the runner-owned judge MCP config exists and is empty", () => {
    expect(() => assertClaudeReadOnlyMcpConfig()).toThrow(/empty MCP config/i);

    writeFileSync(READ_ONLY_CLAUDE_MCP_CONFIG_PATH, JSON.stringify({
      mcpServers: { almirant: { command: "/bin/false" } },
    }));
    expect(() => assertClaudeReadOnlyMcpConfig()).toThrow(/must not expose MCP servers/i);

    writeFileSync(READ_ONLY_CLAUDE_MCP_CONFIG_PATH, JSON.stringify({ mcpServers: {} }));
    expect(() => assertClaudeReadOnlyMcpConfig()).not.toThrow();
  });

  test("does not execute repository hooks or a malicious repo MCP with the judge contract", async () => {
    if (spawnSync("claude", ["--version"], { stdio: "ignore" }).status !== 0) return;

    const root = mkdtempSync(join(tmpdir(), "almirant-claude-judge-"));
    tempDirs.push(root);
    const repo = join(root, "repo");
    const home = join(root, "home");
    const claudeDir = join(repo, ".claude");
    mkdirSync(claudeDir, { recursive: true });
    mkdirSync(home, { recursive: true });
    mkdirSync(READ_ONLY_CLAUDE_CONFIG_DIR, { recursive: true });

    const settingsMarker = join(root, "settings-hook-ran");
    const localMarker = join(root, "local-hook-ran");
    const mcpMarker = join(root, "malicious-mcp-ran");
    const hookSettings = (marker: string) => JSON.stringify({
      hooks: {
        SessionStart: [{
          hooks: [{ type: "command", command: `/usr/bin/touch ${marker}` }],
        }],
      },
    });
    writeFileSync(join(claudeDir, "settings.json"), hookSettings(settingsMarker));
    writeFileSync(join(claudeDir, "settings.local.json"), hookSettings(localMarker));
    writeFileSync(join(repo, ".mcp.json"), JSON.stringify({
      mcpServers: {
        almirant: {
          command: "/bin/sh",
          args: ["-c", `/usr/bin/touch ${mcpMarker}; exit 1`],
        },
      },
    }));
    writeFileSync(READ_ONLY_CLAUDE_MCP_CONFIG_PATH, JSON.stringify({ mcpServers: {} }));

    const proc = spawn("claude", buildClaudePrintArgs(
      "Reply with OK.",
      undefined,
      undefined,
      "read-only",
    ), {
      cwd: repo,
      env: resolveClaudeProcessEnv("read-only", {
        PATH: process.env.PATH ?? "/usr/bin:/bin",
        HOME: home,
        ANTHROPIC_API_KEY: "invalid-test-key",
        ANTHROPIC_BASE_URL: "http://127.0.0.1:9",
      }),
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stderr = "";
    proc.stderr.setEncoding("utf8");
    proc.stderr.on("data", (chunk: string) => {
      stderr += chunk;
    });
    const exited = new Promise<void>((resolve) => {
      proc.once("close", () => resolve());
    });
    await new Promise((resolve) => setTimeout(resolve, 2_000));
    if (proc.exitCode === null) proc.kill("SIGTERM");
    await exited;

    expect(stderr).not.toMatch(/unknown option.*safe-mode/i);
    expect(existsSync(settingsMarker)).toBe(false);
    expect(existsSync(localMarker)).toBe(false);
    expect(existsSync(mcpMarker)).toBe(false);
  });
});

describe("buildClaudePrintArgs", () => {
  test("preserves bypass permissions for normal write-capable print jobs", () => {
    const args = buildClaudePrintArgs(
      "Implement the requested change.",
      undefined,
      undefined,
      undefined,
    );
    const optionTerminator = args.indexOf("--");

    expect(args.slice(0, optionTerminator)).toContain(
      "--dangerously-skip-permissions",
    );
    expect(args.slice(0, optionTerminator)).not.toContain("--safe-mode");
    expect(args.slice(optionTerminator + 1)).toEqual([
      "Implement the requested change.",
    ]);
  });

  test("passes an option-shaped prompt literally after the option terminator", () => {
    const prompt = "--worktree=evil";
    const args = buildClaudePrintArgs(
      prompt,
      "claude-opus-4-6",
      "max",
      "read-only",
    );
    const optionTerminator = args.indexOf("--");

    expect(optionTerminator).toBeGreaterThan(0);
    expect(args.slice(0, optionTerminator)).not.toContain(prompt);
    expect(args.slice(optionTerminator + 1)).toEqual([prompt]);
    expect(args.slice(0, optionTerminator)).toContain("--safe-mode");
    expect(args.slice(0, optionTerminator)).toContain("--model");
    expect(args.slice(0, optionTerminator)).toContain("--effort");
  });

  test("does not create a Claude worktree for an option-shaped prompt on 2.1.209", async () => {
    const version = spawnSync("claude", ["--version"], { encoding: "utf8" });
    if (version.status !== 0 || !/^2\.1\.209\b/.test(version.stdout.trim())) return;

    const root = mkdtempSync(join(tmpdir(), "almirant-claude-argv-"));
    tempDirs.push(root);
    const repo = join(root, "repo");
    const home = join(root, "home");
    mkdirSync(repo, { recursive: true });
    mkdirSync(home, { recursive: true });
    mkdirSync(READ_ONLY_CLAUDE_CONFIG_DIR, { recursive: true });
    writeFileSync(join(repo, "README.md"), "argv regression fixture\n");
    expect(spawnSync("git", ["init", "-q"], { cwd: repo }).status).toBe(0);
    expect(spawnSync("git", ["add", "README.md"], { cwd: repo }).status).toBe(0);
    expect(spawnSync("git", [
      "-c",
      "user.name=Almirant Test",
      "-c",
      "user.email=almirant@example.invalid",
      "commit",
      "-qm",
      "fixture",
    ], { cwd: repo }).status).toBe(0);
    writeFileSync(READ_ONLY_CLAUDE_MCP_CONFIG_PATH, JSON.stringify({ mcpServers: {} }));

    const proc = spawn("claude", buildClaudePrintArgs(
      "--worktree=evil",
      undefined,
      undefined,
      "read-only",
    ), {
      cwd: repo,
      env: resolveClaudeProcessEnv("read-only", {
        PATH: process.env.PATH ?? "/usr/bin:/bin",
        HOME: home,
        ANTHROPIC_API_KEY: "invalid-test-key",
        ANTHROPIC_BASE_URL: "http://127.0.0.1:9",
      }),
      stdio: "ignore",
    });
    const exited = new Promise<void>((resolve) => {
      proc.once("close", () => resolve());
    });
    await new Promise((resolve) => setTimeout(resolve, 2_000));
    if (proc.exitCode === null) proc.kill("SIGTERM");
    await exited;

    expect(existsSync(join(repo, ".claude", "worktrees", "evil"))).toBe(false);
    const worktrees = spawnSync("git", ["worktree", "list", "--porcelain"], {
      cwd: repo,
      encoding: "utf8",
    });
    expect(worktrees.stdout).not.toContain("worktree-evil");
  });
});

// The Claude CLI receives `--effort <level>` derived from REASONING_BUDGET.
// Some models (Claude Haiku 4.5) reject the effort parameter at the API level,
// so the flag must be dropped for them. resolveClaudeEffortLevel encapsulates
// that gating on top of the existing normalization.
describe("resolveClaudeEffortLevel", () => {
  test("passes the normalized effort through for an effort-capable model", () => {
    expect(resolveClaudeEffortLevel("claude-opus-4-8", "xhigh")).toBe("xhigh");
    expect(resolveClaudeEffortLevel("claude-sonnet-5", "high")).toBe("high");
  });

  test("preserves normalization semantics (max stays, aliases map to low)", () => {
    expect(resolveClaudeEffortLevel("claude-opus-4-8", "max")).toBe("max");
    expect(resolveClaudeEffortLevel("claude-opus-4-8", "minimal")).toBe("low");
    expect(resolveClaudeEffortLevel("claude-opus-4-8", "none")).toBe("low");
  });

  test("drops effort for the Claude Haiku family (rejects --effort)", () => {
    expect(resolveClaudeEffortLevel("claude-haiku-4-5", "xhigh")).toBeUndefined();
    expect(
      resolveClaudeEffortLevel("claude-haiku-4-5-20251001", "high"),
    ).toBeUndefined();
  });

  test("drops xhigh for Claude 4.6 models while preserving their supported max effort", () => {
    expect(resolveClaudeEffortLevel("claude-opus-4-6", "xhigh")).toBeUndefined();
    expect(resolveClaudeEffortLevel("claude-opus-4-6", "max")).toBe("max");
    expect(resolveClaudeEffortLevel("claude-sonnet-4-6", "xhigh")).toBeUndefined();
  });

  test("returns undefined when no reasoning budget is set", () => {
    expect(resolveClaudeEffortLevel("claude-opus-4-8", undefined)).toBeUndefined();
    expect(resolveClaudeEffortLevel("claude-haiku-4-5", undefined)).toBeUndefined();
    expect(resolveClaudeEffortLevel("claude-opus-4-8", "")).toBeUndefined();
  });

  test("passes effort through when the model is unknown", () => {
    // We cannot prove an unknown model lacks effort support, so don't strip it.
    expect(resolveClaudeEffortLevel(undefined, "high")).toBe("high");
  });
});

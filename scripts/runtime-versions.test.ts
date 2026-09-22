import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const root = join(import.meta.dir, "..");
const read = (path: string) => readFileSync(join(root, path), "utf8");

const versions = {
  claudeCode: "2.1.280",
  legacyWorkerClaudeCode: "2.1.209",
  openCode: "1.18.32",
  codex: "0.156.0",
  pi: "0.87.1",
  playwrightMcp: "0.0.82",
} as const;

describe("agent runtime version manifest", () => {
  test("pins the exact CLI and SDK package versions in runtime containers", () => {
    expect(read("services/runner-claude/Dockerfile")).toContain(
      `@anthropic-ai/claude-code@${versions.claudeCode}`,
    );
    expect(read("services/runner/docker/Dockerfile.opencode")).toContain(
      `opencode-ai@${versions.openCode}`,
    );

    expect(read("services/runner/docker/Dockerfile.pi")).toContain(
      `@earendil-works/pi-coding-agent@${versions.pi}`,
    );

    const codexPackage = JSON.parse(
      read("services/runner/docker/codex-shim/package.json"),
    ) as { dependencies: Record<string, string> };
    expect(codexPackage.dependencies["@openai/codex"]).toBe(versions.codex);
    expect(codexPackage.dependencies["@openai/codex-sdk"]).toBe(versions.codex);
  });

  test("pins Playwright MCP consistently in every agent image", () => {
    for (const dockerfile of [
      "services/runner-claude/Dockerfile",
      "services/runner/docker/Dockerfile.codex",
      "services/runner/docker/Dockerfile.opencode",
    ]) {
      expect(read(dockerfile)).toContain(`@playwright/mcp@${versions.playwrightMcp}`);
    }
  });

  test("keeps the legacy worker on its pinned Claude Code runtime", () => {
    const workerPackage = JSON.parse(read("worker/package.json")) as {
      dependencies: Record<string, string>;
    };
    expect(workerPackage.dependencies["@anthropic-ai/claude-code"]).toBe(
      versions.legacyWorkerClaudeCode,
    );
    expect(read("worker/Dockerfile")).toContain(
      `@anthropic-ai/claude-code@${versions.legacyWorkerClaudeCode}`,
    );
  });

  test("uses truthful image tags that match the packaged primary runtime", () => {
    const manifest = JSON.parse(read("config/shim-images.json")) as Record<
      "claude" | "codex" | "opencode" | "pi",
      { repository: string; tag: string }
    >;
    expect(manifest.claude.tag).toBe(versions.claudeCode);
    expect(manifest.codex.tag).toBe(versions.codex);
    expect(manifest.opencode.tag).toBe(versions.openCode);
    expect(manifest.pi.tag).toBe(versions.pi);
  });

  test("aligns env examples, compose files, docs and runtime defaults with the manifest", () => {
    const expectedImages = [
      `almirant-opencode-shim:${versions.openCode}`,
      `almirant-claude-shim:${versions.claudeCode}`,
      `almirant-codex-shim:${versions.codex}`,
    ];
    for (const path of [
      ".env.example",
      ".env.production.example",
      "docker-compose.yml",
      "docker-compose.prod.yml",
      "services/runner/docker-compose.prod.yml",
      "services/runner/src/shared/config.ts",
      "docs/self-hosting/environment.md",
    ]) {
      for (const image of expectedImages) {
        expect(read(path)).toContain(image);
      }
    }
    expect(read("backend/packages/remote-agent/src/agents/opencode/types.ts")).toContain(
      `opencode-shim:${versions.openCode}`,
    );
  });

  test("aligns the Pi image tag where a tag is expected at all", () => {
    for (const path of [
      "docker-compose.yml",
      "docker-compose.prod.yml",
      "services/runner/docker-compose.prod.yml",
      "services/runner/src/shared/config.ts",
      "docs/self-hosting/environment.md",
    ]) {
      expect(read(path)).toContain(`almirant-pi-shim:${versions.pi}`);
    }
    // Production pins Pi by immutable digest instead of a tag.
    expect(read(".env.production.example")).toContain(
      "PI_SHIM_IMAGE=YOUR_DOCKERHUB_USERNAME/almirant-pi-shim@sha256:",
    );
  });

  test("keeps deprecated local and preview compose variants absent", () => {
    expect(existsSync(join(root, "docker-compose.local.yml"))).toBe(false);
    expect(existsSync(join(root, "docker-compose.preview.yml"))).toBe(false);
    expect(existsSync(join(root, "docker-compose.validate.yml"))).toBe(false);
    expect(
      existsSync(join(root, "services/runner/docker/docker-compose.dev.yml")),
    ).toBe(false);
  });

  test("keeps Claude Code above the minimum required by ultracode", () => {
    const parts = versions.claudeCode.split(".").map(Number);
    const numeric = parts[0]! * 1_000_000 + parts[1]! * 1_000 + parts[2]!;
    const ultracodeMinimum = 2 * 1_000_000 + 1 * 1_000 + 203;
    expect(numeric).toBeGreaterThanOrEqual(ultracodeMinimum);
  });

  test("isolates read-only Claude judges with deny-first CLI flags and no MCP", () => {
    const entrypoint = read("services/runner/docker/entrypoint-shim.sh");
    const adapter = read("services/runner-claude/shim/src/claude-adapter.ts");

    expect(entrypoint).toContain('ALMIRANT_CLAUDE_TOOL_POLICY:-');
    expect(entrypoint).toContain('printf \'%s\' \'{"mcpServers":{}}\'');
    expect(entrypoint).toContain("export CLAUDE_CODE_SAFE_MODE=1");
    expect(entrypoint).toContain('export CLAUDE_CONFIG_DIR="$READ_ONLY_CLAUDE_CONFIG_DIR"');
    expect(entrypoint).toContain("unset CLAUDE_MCP_JSON");

    for (const requiredFlag of [
      '"--safe-mode"',
      '"--strict-mcp-config"',
      '"--setting-sources"',
      '"--no-session-persistence"',
      '"--no-chrome"',
      '"--disable-slash-commands"',
      '"--permission-mode"',
      '"--allowedTools"',
      '"--disallowedTools"',
    ]) {
      expect(adapter).toContain(requiredFlag);
    }
    expect(adapter).toContain('"Read,Glob,Grep"');
    expect(adapter).toContain(
      '"Bash,Edit,Write,NotebookEdit,WebFetch,WebSearch,Task,Agent"',
    );
  });
});

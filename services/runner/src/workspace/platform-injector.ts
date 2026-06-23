import { readFile, readdir, stat } from "node:fs/promises";
import { basename, join, relative } from "node:path";
import type { ContainerManager } from "./container-manager";

const LOG_PREFIX = "[platform-injector]";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type PlatformInjectorConfig = {
  platformConfigPath: string; // e.g. /app/platform-config
};

export type PlatformInjectionResult = {
  injectedPaths: string[];
  trackedPathsAssumedUnchanged: string[];
  excludedPaths: string[];
  claudeMdAction: "created" | "appended" | "skipped";
  agentsMdAction: "created" | "appended" | "skipped";
  diagnostics: string[];
};

type InjectOptions = {
  containerId: string;
  workspacePath: string; // /workspace/repo
  runtime: "claude-code" | "opencode" | "codex";
  containerManager: ContainerManager;
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Recursively collect all file paths under `dir`, returning paths relative to `base`.
 * Follows symlinks so that the platform-config symlinked directories are resolved.
 */
const walkDir = async (dir: string, base: string): Promise<string[]> => {
  const results: string[] = [];
  let entries: string[];
  try {
    entries = await readdir(dir);
  } catch {
    return results;
  }

  for (const entry of entries) {
    const fullPath = join(dir, entry);
    try {
      const info = await stat(fullPath);
      if (info.isDirectory()) {
        const nested = await walkDir(fullPath, base);
        results.push(...nested);
      } else {
        results.push(relative(base, fullPath));
      }
    } catch {
      // Skip unreadable entries
    }
  }

  return results;
};

const formatProbeOutput = (value: string): string =>
  value
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 500);

const probeWorkspaceState = async (
  containerId: string,
  workspacePath: string,
  containerManager: ContainerManager,
): Promise<string[]> => {
  try {
    const probe = await containerManager.execInContainer(
      containerId,
      [
        "sh",
        "-lc",
        [
          "id",
          "ls -ld /workspace /workspace/repo 2>&1 || true",
          "df -h /workspace /tmp /home/opencode 2>&1 || true",
          "touch /workspace/repo/.platform-injector-probe 2>/tmp/platform-injector-touch.err; status=$?",
          "echo PROBE_TOUCH_EXIT:$status",
          "cat /tmp/platform-injector-touch.err 2>/dev/null || true",
          "rm -f /workspace/repo/.platform-injector-probe /tmp/platform-injector-touch.err",
        ].join("; "),
      ],
      "/",
    );

    return [
      `probe.exit=${probe.exitCode}`,
      `probe.stdout=${formatProbeOutput(probe.stdout)}`,
      `probe.stderr=${formatProbeOutput(probe.stderr)}`,
      `probe.workspacePath=${workspacePath}`,
    ];
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    return [`probe.error=${msg}`];
  }
};

const formatDiagError = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

const getClaudeAgentNameFromPath = (relativePath: string): string =>
  basename(relativePath, ".md");

const shellQuote = (value: string): string =>
  `'${value.replace(/'/g, "'\"'\"'")}'`;

const normalizeClaudeAgentFrontmatter = (
  content: string,
  agentName: string,
): string => {
  const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---(\n|$)/);
  if (!frontmatterMatch) return content;

  const frontmatter = frontmatterMatch[1];
  const lines = frontmatter.split("\n");
  const normalizedLines: string[] = [];
  let hasName = false;

  for (let index = 0; index < lines.length; index++) {
    const line = lines[index] ?? "";
    if (/^\s*name\s*:/.test(line)) {
      hasName = true;
      normalizedLines.push(line);
      continue;
    }

    if (/^\s*(model|mode)\s*:/.test(line)) {
      continue;
    }

    if (/^\s*tools\s*:\s*$/.test(line)) {
      let nextIndex = index + 1;
      while (
        nextIndex < lines.length &&
        /^\s+/.test(lines[nextIndex] ?? "")
      ) {
        nextIndex++;
      }
      index = nextIndex - 1;
      continue;
    }

    normalizedLines.push(line);
  }

  if (!hasName) {
    normalizedLines.unshift(`name: ${agentName}`);
  }

  const suffix = frontmatterMatch[2] ?? "";
  return `---\n${normalizedLines.join("\n")}\n---${suffix}${content.slice(frontmatterMatch[0].length)}`;
};

const transformInjectedFileContent = (params: {
  runtime: InjectOptions["runtime"];
  relativePath: string;
  content: Buffer;
}): Buffer => {
  const { runtime, relativePath, content } = params;

  if (
    (runtime === "claude-code" || runtime === "codex")
    && relativePath.startsWith(".claude/agents/")
    && relativePath.endsWith(".md")
  ) {
    return Buffer.from(
      normalizeClaudeAgentFrontmatter(
        content.toString("utf8"),
        getClaudeAgentNameFromPath(relativePath),
      ),
      "utf8",
    );
  }

  return content;
};

const ensureOpenCodeAgentDiscoveryPath = async (opts: {
  containerId: string;
  workspacePath: string;
  containerManager: ContainerManager;
  platformConfigPath: string;
  result: PlatformInjectionResult;
}): Promise<string[]> => {
  const {
    containerId,
    workspacePath,
    containerManager,
    platformConfigPath,
    result,
  } = opts;
  const platformAgentsDir = join(platformConfigPath, ".agents", "agents");

  try {
    const info = await stat(platformAgentsDir);
    if (!info.isDirectory()) {
      result.diagnostics.push("opencodeAgents.skipped=source-not-directory");
      return [];
    }
  } catch (error) {
    result.diagnostics.push(`opencodeAgents.skipped=${formatDiagError(error)}`);
    return [];
  }

  const sourceAgentPaths = (await walkDir(platformAgentsDir, platformConfigPath))
    .filter((path) => path.startsWith(".agents/agents/") && path.endsWith(".md"))
    .sort();

  if (sourceAgentPaths.length === 0) {
    result.diagnostics.push("opencodeAgents.skipped=no-agent-files");
    return [];
  }

  const firstAgentRelativePath = sourceAgentPaths[0]!.replace(/^\.agents\/agents\//, "");
  const linkCommand = [
    "mkdir -p .opencode",
    "if [ ! -e .opencode/agents ]; then ln -s ../.agents/agents .opencode/agents; fi",
    '[ "$(readlink .opencode/agents 2>/dev/null)" = "../.agents/agents" ]',
    `test -f .opencode/agents/${shellQuote(firstAgentRelativePath)}`,
  ].join(" && ");

  try {
    const linkResult = await containerManager.execInContainer(
      containerId,
      ["sh", "-lc", linkCommand],
      workspacePath,
    );

    if (linkResult.exitCode === 0) {
      result.diagnostics.push("opencodeAgents.discovery=symlink");
      return [".opencode/agents"];
    }

    result.diagnostics.push(
      `opencodeAgents.symlinkFailed=exit:${linkResult.exitCode}:${formatProbeOutput(linkResult.stderr)}`,
    );
  } catch (error) {
    result.diagnostics.push(`opencodeAgents.symlinkFailed=${formatDiagError(error)}`);
  }

  const copiedPaths: string[] = [];
  for (const sourcePath of sourceAgentPaths) {
    const agentRelativePath = sourcePath.replace(/^\.agents\/agents\//, "");
    const targetRelativePath = `.opencode/agents/${agentRelativePath}`;
    try {
      const content = await readFile(join(platformConfigPath, sourcePath));
      await containerManager.writeFileBufferViaExec(
        containerId,
        join(workspacePath, targetRelativePath),
        content,
      );
      copiedPaths.push(targetRelativePath);
    } catch (error) {
      result.diagnostics.push(
        `opencodeAgents.copyFailed.${agentRelativePath}=${formatDiagError(error)}`,
      );
    }
  }

  result.diagnostics.push(`opencodeAgents.discovery=copied:${copiedPaths.length}`);
  return copiedPaths;
};

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export const createPlatformInjector = (config: PlatformInjectorConfig) => {
  const inject = async (opts: InjectOptions): Promise<PlatformInjectionResult> => {
    const { containerId, workspacePath, runtime, containerManager } = opts;

    const result: PlatformInjectionResult = {
      injectedPaths: [],
      trackedPathsAssumedUnchanged: [],
      excludedPaths: [],
      claudeMdAction: "skipped",
      agentsMdAction: "skipped",
      diagnostics: [],
    };

    // -----------------------------------------------------------------------
    // Step 1: Determine directories to copy based on runtime
    // -----------------------------------------------------------------------

    const dirsToCopy: string[] = [];

    if (runtime === "claude-code" || runtime === "codex") {
      dirsToCopy.push(".claude");
    }
    if (runtime === "opencode" || runtime === "codex") {
      dirsToCopy.push(".agents");
    }

    if (dirsToCopy.length === 0) {
      console.warn(`${LOG_PREFIX} No directories to copy for runtime: ${runtime}`);
      return result;
    }

    // -----------------------------------------------------------------------
    // Step 2: Create tar buffer and extract into container
    // -----------------------------------------------------------------------

    let lastAttemptedPath: string | null = null;
    try {
      for (const dir of dirsToCopy) {
        const dirPath = join(config.platformConfigPath, dir);
        result.diagnostics.push(`platformConfigPath=${config.platformConfigPath}`);
        result.diagnostics.push(`process.cwd=${process.cwd()}`);
        try {
          const info = await stat(dirPath);
          result.diagnostics.push(`dir.${dir}.isDirectory=${String(info.isDirectory())}`);
        } catch (error) {
          result.diagnostics.push(`dir.${dir}.statError=${formatDiagError(error)}`);
        }
        try {
          const entries = await readdir(dirPath);
          result.diagnostics.push(`dir.${dir}.entries=${entries.length}`);
          if (entries.length > 0) {
            result.diagnostics.push(`dir.${dir}.firstEntries=${entries.slice(0, 5).join(",")}`);
          }
        } catch (error) {
          result.diagnostics.push(`dir.${dir}.readdirError=${formatDiagError(error)}`);
        }
        const files = await walkDir(dirPath, config.platformConfigPath);
        result.diagnostics.push(`dir.${dir}.files=${files.length}`);
        for (const relPath of files) {
          const content = transformInjectedFileContent({
            runtime,
            relativePath: relPath,
            content: await readFile(join(config.platformConfigPath, relPath)),
          });
          const containerPath = join(workspacePath, relPath);
          lastAttemptedPath = `${relPath} -> ${containerPath}`;
          await containerManager.writeFileBufferViaExec(containerId, containerPath, content);
        }
      }
      console.log(`${LOG_PREFIX} Extracted platform config (${dirsToCopy.join(", ")}) into ${workspacePath}`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      result.diagnostics.push(`extract.error=${msg}`);
      if (lastAttemptedPath) {
        result.diagnostics.push(`extract.lastPath=${lastAttemptedPath}`);
      }
      result.diagnostics.push(
        ...(await probeWorkspaceState(containerId, workspacePath, containerManager)),
      );
      console.warn(
        `${LOG_PREFIX} Failed to extract platform config (non-fatal): ${msg}; diagnostics=${result.diagnostics.join(" | ")}`,
      );
      return result;
    }

    // -----------------------------------------------------------------------
    // Step 3: Collect injected file paths
    // -----------------------------------------------------------------------

    for (const dir of dirsToCopy) {
      try {
        const dirPath = join(config.platformConfigPath, dir);
        const files = await walkDir(dirPath, config.platformConfigPath);
        result.injectedPaths.push(...files);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.warn(`${LOG_PREFIX} Failed to walk ${dir} for path collection (non-fatal): ${msg}`);
      }
    }

    if (runtime === "opencode") {
      const opencodeAgentDiscoveryPaths = await ensureOpenCodeAgentDiscoveryPath({
        containerId,
        workspacePath,
        containerManager,
        platformConfigPath: config.platformConfigPath,
        result,
      });
      result.injectedPaths.push(...opencodeAgentDiscoveryPaths);
    }

    // -----------------------------------------------------------------------
    // Step 4: Process CLAUDE.md (claude-code or codex)
    // -----------------------------------------------------------------------

    if (runtime === "claude-code" || runtime === "codex") {
      result.claudeMdAction = await processMdFile({
        containerId,
        workspacePath,
        containerManager,
        platformSourcePath: join(config.platformConfigPath, "CLAUDE.md.platform"),
        targetFilename: "CLAUDE.md",
        label: "CLAUDE.md",
      });

      if (result.claudeMdAction !== "skipped") {
        result.injectedPaths.push("CLAUDE.md");
      } else {
        result.diagnostics.push("claudeMd.skipped");
      }
    }

    // -----------------------------------------------------------------------
    // Step 5: Process AGENTS.md (opencode or codex)
    // -----------------------------------------------------------------------

    if (runtime === "opencode" || runtime === "codex") {
      result.agentsMdAction = await processMdFile({
        containerId,
        workspacePath,
        containerManager,
        platformSourcePath: join(config.platformConfigPath, "AGENTS.md.platform"),
        targetFilename: "AGENTS.md",
        label: "AGENTS.md",
      });

      if (result.agentsMdAction !== "skipped") {
        result.injectedPaths.push("AGENTS.md");
      } else {
        result.diagnostics.push("agentsMd.skipped");
      }
    }

    // -----------------------------------------------------------------------
    // Step 6: Git exclusion (dual mechanism)
    // -----------------------------------------------------------------------

    await applyGitExclusions({
      containerId,
      workspacePath,
      containerManager,
      paths: result.injectedPaths,
      result,
    });

    console.log(
      `${LOG_PREFIX} Injection complete: ${result.injectedPaths.length} files, ` +
      `${result.trackedPathsAssumedUnchanged.length} assumed-unchanged, ` +
      `${result.excludedPaths.length} excluded, ` +
      `CLAUDE.md=${result.claudeMdAction}, AGENTS.md=${result.agentsMdAction}`,
    );

    if (result.injectedPaths.length === 0 && dirsToCopy.length > 0) {
      console.error(
        `${LOG_PREFIX} CANARY: Expected to inject files from ${dirsToCopy.join(", ")} but injectedPaths is empty. ` +
        `This likely means the platform config is missing or extraction failed silently. ` +
        `Diagnostics: ${result.diagnostics.join(" | ")}`,
      );
    }

    return result;
  };

  return { inject };
};

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Process a markdown file: read platform source, check if target exists in
 * container, then create or append.
 */
const processMdFile = async (opts: {
  containerId: string;
  workspacePath: string;
  containerManager: ContainerManager;
  platformSourcePath: string;
  targetFilename: string;
  label: string;
}): Promise<"created" | "appended" | "skipped"> => {
  const { containerId, workspacePath, containerManager, platformSourcePath, targetFilename, label } = opts;

  // Read platform instructions from runner filesystem
  let platformContent: string;
  try {
    platformContent = await readFile(platformSourcePath, "utf-8");
  } catch (error) {
    const msg = formatDiagError(error);
    console.warn(`${LOG_PREFIX} Platform source not found at ${platformSourcePath}, skipping ${label}: ${msg}`);
    return "skipped";
  }

  if (!platformContent.trim()) {
    console.warn(`${LOG_PREFIX} Platform source is empty at ${platformSourcePath}, skipping ${label}`);
    return "skipped";
  }

  // Check if target file exists in container
  let existingContent = "";
  let fileExists = false;

  try {
    const catResult = await containerManager.execInContainer(
      containerId,
      ["cat", targetFilename],
      workspacePath,
    );
    if (catResult.exitCode === 0 && catResult.stdout.length > 0) {
      existingContent = catResult.stdout;
      fileExists = true;
    }
  } catch {
    // File doesn't exist or cat failed -- we'll create it
  }

  // Build final content
  let finalContent: string;
  let action: "created" | "appended";

  if (fileExists) {
    // Append platform content with separator
    finalContent = existingContent.trimEnd() + "\n\n" + platformContent;
    action = "appended";
  } else {
    finalContent = platformContent;
    action = "created";
  }

  // Write directly via exec
  try {
    const contentBuffer = Buffer.from(finalContent, "utf-8");
    const targetPath = join(workspacePath, targetFilename);
    await containerManager.writeFileBufferViaExec(containerId, targetPath, contentBuffer);
    console.log(`${LOG_PREFIX} ${label} ${action} (${contentBuffer.length} bytes)`);
    return action;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`${LOG_PREFIX} Failed to write ${label} (non-fatal): ${msg}`);
    return "skipped";
  }
};

/**
 * Apply git exclusion for injected paths using a dual mechanism:
 *   - Tracked files: git update-index --assume-unchanged
 *   - Untracked files: append to .git/info/exclude
 */
const applyGitExclusions = async (opts: {
  containerId: string;
  workspacePath: string;
  containerManager: ContainerManager;
  paths: string[];
  result: PlatformInjectionResult;
}): Promise<void> => {
  const { containerId, workspacePath, containerManager, paths, result } = opts;

  if (paths.length === 0) return;

  // Classify each path as tracked or untracked
  const trackedPaths: string[] = [];
  const untrackedPaths: string[] = [];

  // Batch check: use git ls-files with all paths at once to reduce exec calls
  try {
    const lsResult = await containerManager.execInContainer(
      containerId,
      ["git", "ls-files", ...paths],
      workspacePath,
    );

    if (lsResult.exitCode === 0) {
      const trackedSet = new Set(
        lsResult.stdout
          .split("\n")
          .map((line) => line.trim())
          .filter((line) => line.length > 0),
      );

      for (const p of paths) {
        if (trackedSet.has(p)) {
          trackedPaths.push(p);
        } else {
          untrackedPaths.push(p);
        }
      }
    } else {
      // If git ls-files fails, treat all as untracked
      untrackedPaths.push(...paths);
    }
  } catch {
    // If exec fails entirely, treat all as untracked
    untrackedPaths.push(...paths);
  }

  // For tracked files: batch git update-index --assume-unchanged
  if (trackedPaths.length > 0) {
    try {
      const assumeResult = await containerManager.execInContainer(
        containerId,
        ["git", "update-index", "--assume-unchanged", ...trackedPaths],
        workspacePath,
      );

      if (assumeResult.exitCode === 0) {
        result.trackedPathsAssumedUnchanged.push(...trackedPaths);
        console.log(`${LOG_PREFIX} Marked ${trackedPaths.length} tracked paths as assume-unchanged`);
      } else {
        console.warn(
          `${LOG_PREFIX} git update-index failed (exit ${assumeResult.exitCode}): ${assumeResult.stderr}`,
        );
        // Fall back: add these to exclude as well
        untrackedPaths.push(...trackedPaths);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(`${LOG_PREFIX} git update-index failed (non-fatal): ${msg}`);
      untrackedPaths.push(...trackedPaths);
    }
  }

  // For untracked files: append to .git/info/exclude
  if (untrackedPaths.length > 0) {
    try {
      // Read existing exclude content
      let existingExclude = "";
      try {
        const catResult = await containerManager.execInContainer(
          containerId,
          ["cat", ".git/info/exclude"],
          workspacePath,
        );
        if (catResult.exitCode === 0) {
          existingExclude = catResult.stdout;
        }
      } catch {
        // File might not exist yet
      }

      // Build new exclude content
      const header = "# -- almirant platform-injector (auto-generated) --";
      const excludeLines = untrackedPaths.map((p) => `/${p}`).join("\n");
      const newExclude = existingExclude.trimEnd() + "\n\n" + header + "\n" + excludeLines + "\n";

      // Write directly via exec
      const excludeBuffer = Buffer.from(newExclude, "utf-8");
      const excludePath = join(workspacePath, ".git/info/exclude");
      await containerManager.writeFileBufferViaExec(containerId, excludePath, excludeBuffer);

      result.excludedPaths.push(...untrackedPaths);
      console.log(`${LOG_PREFIX} Added ${untrackedPaths.length} paths to .git/info/exclude`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(`${LOG_PREFIX} Failed to update .git/info/exclude (non-fatal): ${msg}`);
    }
  }
};

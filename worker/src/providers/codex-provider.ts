import { buildImplementationPrompt } from "./prompt-builder.js";
import type {
  AgentEnvironment,
  AgentHandle,
  AgentProviderConfig,
  AgentResult,
  AgentTaskInput,
  AgentProgress,
  CodingAgentProvider,
} from "./types.js";

type CodexProviderConfig = {
  /**
   * Codex executable name/path. Defaults to "codex" (must be in PATH).
   * Allows testing against a custom binary if needed.
   */
  codexCommand?: string;
};

type ActiveRun = {
  process: ReturnType<typeof Bun.spawn>;
};

const activeRuns = new Map<AgentHandle, ActiveRun>();

const nowIso = () => new Date().toISOString();

const toProgress = (phase: AgentProgress["phase"], message: string): AgentProgress => ({
  phase,
  message,
  timestamp: nowIso(),
});

const tryParseJsonLines = (text: string) => {
  const events: Array<Record<string, unknown>> = [];
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const obj = JSON.parse(trimmed);
      if (obj && typeof obj === "object") events.push(obj as Record<string, unknown>);
    } catch {
      // ignore non-JSON lines
    }
  }
  return events;
};

const extractSummaryFromEvents = (events: Array<Record<string, unknown>>) => {
  // Best-effort: Codex JSON schema may evolve; prefer an explicit "final" message-like payload if present.
  const candidates: string[] = [];
  for (const e of events) {
    const type = e.type;
    if (type === "final" || type === "result" || type === "message") {
      const text = (e.text ?? e.message ?? e.output ?? e.content) as unknown;
      if (typeof text === "string" && text.trim()) candidates.push(text.trim());
    }
  }
  return candidates.length ? candidates[candidates.length - 1] : undefined;
};

const extractCostTokensFromEvents = (events: Array<Record<string, unknown>>) => {
  // Best-effort: look for a "usage" object and a "cost" field.
  let cost: number | undefined;
  let tokens: number | undefined;

  for (const e of events) {
    const maybeCost = (e.total_cost_usd ?? e.cost_usd ?? e.costUSD ?? e.cost) as unknown;
    if (typeof maybeCost === "number") cost = maybeCost;

    const usage = e.usage as unknown;
    if (usage && typeof usage === "object") {
      const u = usage as Record<string, unknown>;
      const input = (u.input_tokens ?? u.inputTokens) as unknown;
      const output = (u.output_tokens ?? u.outputTokens) as unknown;
      if (typeof input === "number" && typeof output === "number") tokens = input + output;
    }
  }

  return { cost, tokens };
};

const listChangedFiles = async (repoPath: string): Promise<string[]> => {
  // Real, provider-agnostic "files changed": git status includes modified + untracked.
  const proc = Bun.spawn({
    cmd: ["git", "status", "--porcelain"],
    cwd: repoPath,
    stdout: "pipe",
    stderr: "pipe",
  });

  const stdout = await new Response(proc.stdout).text();
  await proc.exited;

  const files = new Set<string>();
  for (const line of stdout.split("\n")) {
    // Porcelain format: XY <path> or ?? <path>
    const trimmed = line.trimEnd();
    if (!trimmed) continue;
    const path = trimmed.slice(3).trim();
    if (path) files.add(path);
  }
  return Array.from(files);
};

export const createCodexProvider = (config: CodexProviderConfig = {}): CodingAgentProvider => {
  const abort = (handle: AgentHandle) => {
    const run = activeRuns.get(handle);
    if (!run) return;
    try {
      run.process.kill();
    } finally {
      activeRuns.delete(handle);
    }
  };

  const execute: CodingAgentProvider["execute"] = async (
    task: AgentTaskInput,
    env: AgentEnvironment,
    _providerConfig: AgentProviderConfig,
    onProgress?: (progress: AgentProgress) => void,
  ) => {
    const handle = crypto.randomUUID() as AgentHandle;
    const startedAt = Date.now();

    // Codex performs best with very explicit instructions and "no ambiguity".
    const prompt = [
      buildImplementationPrompt(task, env),
      "",
      "## Codex-specific notes",
      "- Prefer small, targeted diffs.",
      "- Print a brief final summary of what you changed and why.",
    ].join("\n");

    onProgress?.(toProgress("starting", "Starting Codex CLI"));

    const cmd = config.codexCommand ?? "codex";

    // Read prompt from stdin by passing '-' as PROMPT argument.
    const proc = Bun.spawn({
      cmd: [cmd, "exec", "--json", "--full-auto", "-C", env.repoPath, "-s", "workspace-write", "-"],
      cwd: env.repoPath,
      stdin: "pipe",
      stdout: "pipe",
      stderr: "pipe",
    });

    activeRuns.set(handle, { process: proc });

    // Feed prompt to stdin then close.
    proc.stdin.write(prompt);
    proc.stdin.end();

    const [stdout, stderr] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
    ]);

    const exitCode = await proc.exited;
    activeRuns.delete(handle);

    const durationMs = Date.now() - startedAt;

    const events = tryParseJsonLines(stdout);
    const { cost, tokens } = extractCostTokensFromEvents(events);
    const summary = extractSummaryFromEvents(events) ?? (stderr.trim() || "Codex CLI finished.");
    const filesChanged = await listChangedFiles(env.repoPath);

    const result: AgentResult = {
      success: exitCode === 0,
      filesChanged,
      durationMs,
      cost,
      tokens,
      summary,
    };

    return { result, handle };
  };

  return { execute, abort };
};

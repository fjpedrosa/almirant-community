// ---------------------------------------------------------------------------
// Shared helpers for canonical event mappers
//
// Extracted from sse-canonical-adapter.ts for reuse across all shim mappers.
// ---------------------------------------------------------------------------

import type { CanonicalEvent } from "@almirant/canonical-events";
import { parseWaveMarker } from "@almirant/canonical-events";

// ---- Tool name classification ----

export const FILE_READ_TOOLS = new Set(["Read", "Glob", "Grep"]);
export const FILE_WRITE_TOOLS = new Set(["Write"]);
export const FILE_EDIT_TOOLS = new Set(["Edit"]);
export const BASH_TOOLS = new Set(["Bash"]);
export const SUBAGENT_TOOLS = new Set(["Task", "Agent"]);

const TOOL_NAME_ALIASES: Record<string, string> = {
  agent: "Agent",
  bash: "Bash",
  edit: "Edit",
  glob: "Glob",
  grep: "Grep",
  read: "Read",
  task: "Task",
  todowrite: "TodoWrite",
  write: "Write",
};

export const normalizeToolName = (toolName: string): string =>
  TOOL_NAME_ALIASES[toolName.toLowerCase()] ?? toolName;

// ---- String extraction helpers ----

/** Extract a JSON field value by key from raw text using regex. */
export const extractField = (raw: string, key: string): string | undefined => {
  const regex = new RegExp(`"${key}"\\s*:\\s*"([^"]*)"`, "i");
  const match = raw.match(regex);
  return match?.[1];
};

/** Extract a parameter from parsed JSON or raw text. */
export const extractParam = (
  parsed: Record<string, unknown> | undefined,
  raw: string,
  key: string,
): string | undefined => {
  if (parsed) {
    const input =
      typeof parsed.input === "object" && parsed.input !== null
        ? (parsed.input as Record<string, unknown>)
        : parsed;
    const val = input[key];
    if (typeof val === "string") return val;
    if (typeof val === "number" || typeof val === "boolean") return String(val);
  }
  return extractField(raw, key);
};

export const extractParamAny = (
  parsed: Record<string, unknown> | undefined,
  raw: string,
  keys: string[],
): string | undefined => {
  for (const key of keys) {
    const value = extractParam(parsed, raw, key);
    if (value !== undefined) return value;
  }
  return undefined;
};

/** Detect if the tool call is for a background agent. */
export const detectBackground = (raw: string): boolean =>
  /(?:run_in_background|runInBackground)["\s]*[:=]\s*true/i.test(raw);

/** Keys whose value should be shown directly (without "key:" prefix) as the preview. */
const PREVIEW_VALUE_ONLY_KEYS = new Set(["title", "description", "name", "prompt"]);

/** Build a short input preview string for tool_call.start events. */
export const extractInputPreview = (
  parsed: Record<string, unknown> | undefined,
  raw: string,
  toolName?: string,
): string | undefined => {
  const normalizedToolName = toolName ? normalizeToolName(toolName) : undefined;
  if (!parsed) {
    if (normalizedToolName && SUBAGENT_TOOLS.has(normalizedToolName)) {
      return raw.slice(0, 300);
    }
    return raw.slice(0, 100);
  }
  const input =
    typeof parsed.input === "object" && parsed.input !== null
      ? (parsed.input as Record<string, unknown>)
      : null;
  if (input) {
    if (normalizedToolName && SUBAGENT_TOOLS.has(normalizedToolName)) {
      const parts: string[] = [];
      if (typeof input.subagent_type === "string") parts.push(`subagent_type: ${input.subagent_type}`);
      if (typeof input.description === "string") parts.push(`description: ${(input.description as string).slice(0, 80)}`);
      if (parts.length > 0) return parts.join(" | ");
    }
    for (const [k, v] of Object.entries(input)) {
      if (typeof v === "string" && v.length > 0) {
        const preview = v.slice(0, 80);
        return PREVIEW_VALUE_ONLY_KEYS.has(k) ? preview : `${k}: ${preview}`;
      }
    }
  }
  return undefined;
};

// ---- Subagent tracker ----

export type SubagentTracker = {
  /** Register a subagent as active. */
  track: (subagentId: string) => void;
  /** Mark a subagent as complete and return the completion event. */
  complete: (subagentId: string, success: boolean) => CanonicalEvent | null;
  /** Complete all remaining active subagents (called on session.idle). */
  completeAll: (success: boolean) => CanonicalEvent[];
  /** Check if a subagent was already spawned (prevents double emission). */
  isEarlySpawned: (toolCallId: string) => boolean;
  /** Mark a tool call as early-spawned. */
  markEarlySpawned: (toolCallId: string) => void;
  /** Reset all state (between turns if needed). */
  reset: () => void;
};

export const createSubagentTracker = (): SubagentTracker => {
  const activeIds = new Set<string>();
  const earlySpawnedIds = new Set<string>();

  return {
    track: (subagentId) => {
      activeIds.add(subagentId);
    },

    complete: (subagentId, success) => {
      if (!activeIds.has(subagentId)) return null;
      activeIds.delete(subagentId);
      return { kind: "agent.subagent.complete", subagentId, success };
    },

    completeAll: (success) => {
      const events: CanonicalEvent[] = [];
      for (const id of activeIds) {
        events.push({ kind: "agent.subagent.complete", subagentId: id, success });
      }
      activeIds.clear();
      return events;
    },

    isEarlySpawned: (toolCallId) => earlySpawnedIds.has(toolCallId),
    markEarlySpawned: (toolCallId) => { earlySpawnedIds.add(toolCallId); },

    reset: () => {
      activeIds.clear();
      earlySpawnedIds.clear();
    },
  };
};

// ---- Tool event helpers ----

/** Emit specialized canonical events based on tool name and parsed input. */
export const emitToolSpecificEvents = (
  toolName: string,
  toolCallId: string,
  parsed: Record<string, unknown> | undefined,
  raw: string,
): CanonicalEvent[] => {
  const events: CanonicalEvent[] = [];
  const normalizedToolName = normalizeToolName(toolName);

  if (FILE_READ_TOOLS.has(normalizedToolName)) {
    const filePath = extractParamAny(parsed, raw, ["file_path", "filePath", "path", "pattern"]);
    if (filePath) {
      const offset = extractParamAny(parsed, raw, ["offset"]);
      const limit = extractParamAny(parsed, raw, ["limit"]);
      events.push({
        kind: "agent.file.read",
        toolCallId,
        filePath,
        lineRange: offset ? `${offset}-${limit ?? ""}` : undefined,
      });
    }
  } else if (FILE_WRITE_TOOLS.has(normalizedToolName)) {
    const filePath = extractParamAny(parsed, raw, ["file_path", "filePath", "path"]);
    if (filePath) events.push({ kind: "agent.file.write", toolCallId, filePath });
  } else if (FILE_EDIT_TOOLS.has(normalizedToolName)) {
    const filePath = extractParamAny(parsed, raw, ["file_path", "filePath", "path"]);
    if (filePath) events.push({ kind: "agent.file.edit", toolCallId, filePath });
  } else if (BASH_TOOLS.has(normalizedToolName)) {
    const command = extractParam(parsed, raw, "command");
    if (command) {
      // Wave-orchestration markers ride on a sentinel `echo` so they can flow
      // through every runtime without a bespoke tool. When one is detected we
      // emit the structured `agent.wave.*` events INSTEAD of a shell command,
      // keeping the marker invisible in the UI. Additive: non-marker commands
      // (parseWaveMarker returns []) fall through unchanged.
      const waveEvents = parseWaveMarker(command);
      if (waveEvents.length > 0) {
        events.push(...waveEvents);
      } else {
        events.push({
          kind: "agent.bash.execute",
          toolCallId,
          command,
          description: extractParam(parsed, raw, "description") ?? undefined,
        });
      }
    }
  } else if (SUBAGENT_TOOLS.has(normalizedToolName)) {
    const isBackground = detectBackground(raw);
    const description =
      extractParam(parsed, raw, "description") ??
      extractParam(parsed, raw, "prompt")?.slice(0, 200) ??
      normalizedToolName;
    const subagentType =
      extractParamAny(parsed, raw, ["subagent_type", "subagentType", "agent"]) ??
      undefined;
    events.push({
      kind: "agent.subagent.spawn",
      subagentId: toolCallId,
      description,
      isBackground,
      subagentType,
    });
  }

  return events;
};

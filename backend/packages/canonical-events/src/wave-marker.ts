// ---------------------------------------------------------------------------
// Wave marker — structured signal for the `agent.wave.*` orchestration events.
//
// The runner-implement skill runs specialist agents wave-by-wave. To surface
// each wave to the UI and to satisfy the INV-1 completion guard, the skill
// emits a machine-formatted marker at every wave boundary via the always
// available `Bash`/`echo` tool:
//
//   echo 'ALMIRANT_WAVE_EVENT {"type":"wave.start","agents":[...]}'
//
// The canonical event mappers read the STRUCTURED tool input (the `command`
// string of a Bash tool call), detect the sentinel prefix, and translate the
// single JSON payload that follows into `agent.wave.*` canonical events. This
// is deterministic — the payload is a strict JSON object the skill fully
// controls — NOT fragile parsing of free-text progress prose.
//
// Living in `@almirant/canonical-events` makes it the single source of truth:
// both the shim-server mapper (`emitToolSpecificEvents`, shared by the claude
// and opencode shims) and the runner SSE adapter (`emitSpecializedToolEvents`)
// import this parser instead of duplicating the format.
// ---------------------------------------------------------------------------

import type {
  AgentWaveDoneEvent,
  AgentWaveEndEvent,
  AgentWaveStartEvent,
  CanonicalEvent,
} from "./index.js";

/** Unique token the skill prefixes to every wave marker payload. */
export const WAVE_MARKER_SENTINEL = "ALMIRANT_WAVE_EVENT";

/** Structured payloads the skill serializes after the sentinel. */
export type WaveMarkerPayload =
  | {
      type: "wave.start";
      agents: Array<{ agent: string; taskId: string; title: string }>;
    }
  | {
      type: "wave.agent_done";
      agent: string;
      taskId: string;
      success: boolean;
      reason?: string;
    }
  | {
      type: "wave.end";
      successCount: number;
      totalCount: number;
    };

/**
 * Build the exact `echo` command the skill runs at a wave boundary. Kept next
 * to the parser so the producer format and the consumer format cannot drift.
 */
export const buildWaveMarkerCommand = (payload: WaveMarkerPayload): string =>
  `echo '${WAVE_MARKER_SENTINEL} ${JSON.stringify(payload)}'`;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

/**
 * Extract the JSON object that follows the sentinel from a raw shell command.
 * Tolerant of surrounding `echo '...'` quoting: it slices from the first `{`
 * after the sentinel to the matching last `}`.
 */
const extractPayloadJson = (command: string): unknown | null => {
  const sentinelIndex = command.indexOf(WAVE_MARKER_SENTINEL);
  if (sentinelIndex === -1) return null;

  const afterSentinel = command.slice(sentinelIndex + WAVE_MARKER_SENTINEL.length);
  const start = afterSentinel.indexOf("{");
  const end = afterSentinel.lastIndexOf("}");
  if (start === -1 || end === -1 || end < start) return null;

  try {
    return JSON.parse(afterSentinel.slice(start, end + 1));
  } catch {
    return null;
  }
};

const toWaveStart = (payload: Record<string, unknown>): AgentWaveStartEvent | null => {
  if (!Array.isArray(payload.agents)) return null;
  const agents = payload.agents
    .filter(
      (entry): entry is { agent: string; taskId: string; title: string } =>
        isRecord(entry) &&
        typeof entry.agent === "string" &&
        typeof entry.taskId === "string" &&
        typeof entry.title === "string",
    )
    .map(({ agent, taskId, title }) => ({ agent, taskId, title }));
  return { kind: "agent.wave.start", agents };
};

const toWaveAgentDone = (
  payload: Record<string, unknown>,
): AgentWaveDoneEvent | null => {
  if (
    typeof payload.agent !== "string" ||
    typeof payload.taskId !== "string" ||
    typeof payload.success !== "boolean"
  ) {
    return null;
  }
  const event: AgentWaveDoneEvent = {
    kind: "agent.wave.agent_done",
    agent: payload.agent,
    taskId: payload.taskId,
    success: payload.success,
  };
  if (typeof payload.reason === "string") event.reason = payload.reason;
  return event;
};

const toWaveEnd = (payload: Record<string, unknown>): AgentWaveEndEvent | null => {
  if (
    typeof payload.successCount !== "number" ||
    typeof payload.totalCount !== "number"
  ) {
    return null;
  }
  return {
    kind: "agent.wave.end",
    successCount: payload.successCount,
    totalCount: payload.totalCount,
  };
};

/**
 * Parse a Bash `command` string into `agent.wave.*` canonical events.
 * Returns `[]` when the command is not a wave marker or the payload is
 * malformed — callers fall back to their normal handling, keeping the change
 * fully additive.
 */
export const parseWaveMarker = (command: string): CanonicalEvent[] => {
  const payload = extractPayloadJson(command);
  if (!isRecord(payload)) return [];

  switch (payload.type) {
    case "wave.start": {
      const event = toWaveStart(payload);
      return event ? [event] : [];
    }
    case "wave.agent_done": {
      const event = toWaveAgentDone(payload);
      return event ? [event] : [];
    }
    case "wave.end": {
      const event = toWaveEnd(payload);
      return event ? [event] : [];
    }
    default:
      return [];
  }
};

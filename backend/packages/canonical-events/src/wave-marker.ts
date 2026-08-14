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
// string of a Bash tool call), detect the sentinel prefix, and translate each
// JSON payload that follows into `agent.wave.*` canonical events. A single
// Bash command may carry several markers (chained with `;`/`&&`) alongside
// real shell work. This is deterministic — each payload is a strict JSON
// object the skill fully controls — NOT fragile parsing of free-text prose.
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

const escapeForPosixSingleQuotes = (value: string): string =>
  value.replace(/'/g, `'\\''`);

/**
 * Build the exact `echo` command the skill runs at a wave boundary. Kept next
 * to the parser so the producer format and the consumer format cannot drift.
 */
export const buildWaveMarkerCommand = (payload: WaveMarkerPayload): string =>
  `echo '${escapeForPosixSingleQuotes(`${WAVE_MARKER_SENTINEL} ${JSON.stringify(payload)}`)}'`;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

type MarkerSpan = {
  sentinelStart: number;
  braceStart: number;
  braceEnd: number;
};

const buildSentinelAnchor = (): RegExp =>
  new RegExp(`${WAVE_MARKER_SENTINEL}[ \\t]*(?=\\{)`, "g");

const findMatchingBraceEnd = (command: string, openIndex: number): number | null => {
  let depth = 0;
  let inString = false;

  for (let i = openIndex; i < command.length; i++) {
    const char = command[i];
    if (char === "\\") {
      // Backslash escapes the next char unconditionally, in or out of a string.
      i++;
      continue;
    }
    if (char === '"') {
      inString = !inString;
      continue;
    }
    if (inString) continue;
    if (char === "{") depth++;
    else if (char === "}") {
      depth--;
      if (depth === 0) return i;
    }
  }
  return null;
};

const scanMarkerSpans = (command: string): MarkerSpan[] => {
  const spans: MarkerSpan[] = [];
  const anchor = buildSentinelAnchor();
  let match: RegExpExecArray | null;

  while ((match = anchor.exec(command)) !== null) {
    const braceStart = match.index + match[0].length;
    const braceEnd = findMatchingBraceEnd(command, braceStart);
    if (braceEnd === null) continue;

    spans.push({ sentinelStart: match.index, braceStart, braceEnd });
    // Resume past the payload, not the sentinel, or an earlier sentinel mention re-adopts it.
    anchor.lastIndex = braceEnd + 1;
  }

  return spans;
};

const parseMarkerSlice = (slice: string): unknown | null => {
  try {
    return JSON.parse(slice);
  } catch {
    const unescaped = slice.replace(/\\"/g, '"').replace(/'\\''/g, "'");
    try {
      return JSON.parse(unescaped);
    } catch {
      return null;
    }
  }
};

const extractPayloads = (command: string): unknown[] => {
  const payloads: unknown[] = [];

  for (const { braceStart, braceEnd } of scanMarkerSpans(command)) {
    const slice = command.slice(braceStart, braceEnd + 1);
    const payload = parseMarkerSlice(slice);
    if (payload === null) {
      console.warn(
        `[wave-marker] failed to parse payload after ${WAVE_MARKER_SENTINEL}: ${slice.slice(0, 200)}`,
      );
      continue;
    }
    payloads.push(payload);
  }

  return payloads;
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
 * Parse a Bash `command` string into `agent.wave.*` canonical events, one per
 * marker found. Returns `[]` when the command has no markers — callers fall
 * back to their normal handling.
 */
export const parseWaveMarker = (command: string): CanonicalEvent[] => {
  const events: CanonicalEvent[] = [];

  for (const payload of extractPayloads(command)) {
    if (!isRecord(payload)) continue;

    switch (payload.type) {
      case "wave.start": {
        const event = toWaveStart(payload);
        if (event) events.push(event);
        break;
      }
      case "wave.agent_done": {
        const event = toWaveAgentDone(payload);
        if (event) events.push(event);
        break;
      }
      case "wave.end": {
        const event = toWaveEnd(payload);
        if (event) events.push(event);
        break;
      }
      default:
        break;
    }
  }

  return events;
};

const findEnclosingEchoSpan = (
  command: string,
  sentinelStart: number,
  braceEnd: number,
): { start: number; end: number } => {
  let start = sentinelStart;
  let quoteChar: "'" | '"' | null = null;

  if (start > 0 && (command[start - 1] === "'" || command[start - 1] === '"')) {
    quoteChar = command[start - 1] as "'" | '"';
    start -= 1;
  }

  let echoScan = start;
  while (echoScan > 0 && /\s/.test(command[echoScan - 1])) echoScan--;
  if (echoScan >= 4 && command.slice(echoScan - 4, echoScan) === "echo") {
    start = echoScan - 4;
  }

  let end = braceEnd + 1;
  if (quoteChar === "'") {
    while (end < command.length) {
      if (
        command[end] === "'" &&
        command[end + 1] === "\\" &&
        command[end + 2] === "'" &&
        command[end + 3] === "'"
      ) {
        end += 4;
        continue;
      }
      if (command[end] === "'") {
        end += 1;
        break;
      }
      end += 1;
    }
  } else if (quoteChar === '"') {
    while (end < command.length) {
      if (command[end] === "\\") {
        end += 2;
        continue;
      }
      if (command[end] === '"') {
        end += 1;
        break;
      }
      end += 1;
    }
  }

  while (start > 0 && /[ \t]/.test(command[start - 1])) start--;
  while (end < command.length && /[ \t]/.test(command[end])) end++;

  return { start, end };
};

/** Removes the WHOLE enclosing `echo` invocation, not just the JSON payload. */
export const stripWaveMarkers = (command: string): string => {
  const spans = scanMarkerSpans(command);
  if (spans.length === 0) return command;

  let result = "";
  let cursor = 0;

  for (const { sentinelStart, braceEnd } of spans) {
    const invocation = findEnclosingEchoSpan(command, sentinelStart, braceEnd);
    result += command.slice(cursor, invocation.start);
    cursor = invocation.end;
  }
  result += command.slice(cursor);

  return result;
};

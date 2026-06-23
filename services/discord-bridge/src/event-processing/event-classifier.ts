// ---------------------------------------------------------------------------
// Event classification — pure domain logic
//
// Classifies canonical events into categories used for routing decisions.
// No framework or infrastructure dependencies.
// ---------------------------------------------------------------------------

import type { BridgeEnv } from "../config";

/**
 * Terminal canonical event kinds. When one of these is received the consumer
 * skips button management — the renderer handles terminal cleanup internally.
 */
export const TERMINAL_CANONICAL_KINDS = new Set([
  "job.completed",
  "job.incomplete",
  "job.failed",
  "job.cancelled",
  "job.timeout",
]);

/**
 * Canonical event kinds that trigger a button update after rendering.
 * Tool calls, file ops, and bash are buffered in the renderer (activity
 * bursts) so they no longer need individual button updates.
 *
 * NOTE: session.connected ensures buttons are created immediately when the
 * session starts. Without it, sessions that only use tool calls and thinking
 * would never trigger button creation because the shim does not emit
 * agent.step events.
 */
export const BUTTON_TRIGGER_KINDS = new Set([
  "session.connected",
  "agent.step",
  "agent.subagent.spawn",
  "agent.subagent.complete",
  "agent.wave.start",
  "agent.wave.agent_done",
  "agent.wave.end",
  "agent.question",
  "agent.permission.request",
  "session.error",
]);

/** Streaming event kinds that are too frequent for button updates. */
export const STREAMING_KINDS = new Set([
  "agent.text",
  "agent.thinking",
  "heartbeat",
]);

export const isTerminalEvent = (kind: string): boolean =>
  TERMINAL_CANONICAL_KINDS.has(kind);

export const isButtonTrigger = (kind: string): boolean =>
  BUTTON_TRIGGER_KINDS.has(kind);

export const isStreamingEvent = (kind: string): boolean =>
  STREAMING_KINDS.has(kind);

/**
 * Content filter — determines whether a content type should pass through
 * to Discord based on the configured filter.
 */
export const passesContentFilter = (
  contentType: "text" | "thinking",
  filter: BridgeEnv["DISCORD_CONTENT_FILTER"],
): boolean => {
  if (filter === "all") return true;
  if (filter === "text,thinking") return true;
  return filter === contentType;
};

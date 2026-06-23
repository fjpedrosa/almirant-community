import type { AgentOutputEvent } from "@almirant/stream-consumer";
// NOTE: AgentOutputEvent imported directly for explicit visibility
export type { AgentOutputEvent };

/**
 * WS server message format — the shape published to Redis Pub/Sub
 * so the backend WS layer can broadcast to connected clients.
 */
export type WsServerMessage = {
  type: string;
  payload: Record<string, unknown>;
};

/**
 * Maps an AgentOutputEvent (old format) from the Redis stream to a
 * WsServerMessage suitable for the frontend WebSocket layer.
 *
 * Returns `null` for events that should not be broadcast (e.g. tool_use,
 * warn, rich_message, heartbeat).
 *
 * NOTE: This mapper handles the legacy AgentOutputEvent format. When
 * CANONICAL_EVENTS_ENABLED is true on the runner, content events (message,
 * done, error, question) are suppressed in favor of canonical events
 * processed by {@link mapCanonicalEventToWsMessage}. Only Discord-specific
 * events (thread_rename, system messages) continue through this path.
 */
export const mapEventToWsMessage = (
  event: AgentOutputEvent
): WsServerMessage | null => {
  switch (event.type) {
    case "message": {
      const contentType = event.contentType ?? "text";

      // Skip tool_use events — not broadcast to frontend
      if (contentType === "tool_use") return null;

      // Skip setup/system messages from the runner — not user-facing content
      if (!event.contentType) {
        const content = typeof event.content === "string" ? event.content : "";
        if (
          content.startsWith("Runner claimed") ||
          content.startsWith("Container started") ||
          content.startsWith("Prompt sent")
        ) {
          return null;
        }
      }

      if (contentType === "thinking") {
        return {
          type: "planning:thinking",
          payload: { sessionId: event.sessionId, content: event.content },
        };
      }

      // Default: text
      return {
        type: "planning:text",
        payload: { sessionId: event.sessionId, content: event.content },
      };
    }

    case "step":
      return {
        type: "planning:step",
        payload: {
          sessionId: event.sessionId,
          stepName: event.description,
          stepIndex: 0,
        },
      };

    case "done":
      return {
        type: "planning:done",
        payload: { sessionId: event.sessionId },
      };

    case "error":
      return {
        type: "planning:error",
        payload: { sessionId: event.sessionId, message: event.reason },
      };

    case "question":
      return {
        type: "planning:question",
        payload: {
          sessionId: event.sessionId,
          questionId: "",
          questionText: event.text ?? "",
          options: event.options ?? [],
        },
      };

    case "wave_start": {
      const agents = Array.isArray(event.agents)
        ? event.agents.map((a) => ({
            id: a.agent,
            name: a.agent,
            role: a.title,
          }))
        : [];
      return {
        type: "planning:wave-start",
        payload: { sessionId: event.sessionId, agents },
      };
    }

    case "agent_done":
      return {
        type: "planning:agent-done",
        payload: {
          sessionId: event.sessionId,
          agentId: event.agent,
          success: event.status === "SUCCESS",
          ...(event.reason != null ? { reason: event.reason } : {}),
        },
      };

    case "wave_end":
      return {
        type: "planning:wave-end",
        payload: {
          sessionId: event.sessionId,
          successCount: event.successCount,
          totalCount: event.totalCount,
        },
      };

    case "response_complete":
      return {
        type: "planning:response-complete",
        payload: { sessionId: event.sessionId, summary: event.summary },
      };

    // Events with no WS equivalent — skip
    case "warn":
    case "rich_message":
    case "heartbeat":
      return null;

    // Discord-specific or marker-only types that never reach web-bridge as
    // old-format events (filtered by output-router or only used internally):
    //   thread_rename, thread_close, reaction, edit_message, raw, waiting
    default:
      return null;
  }
};

// Canonical event → WS message mapping has been moved to web-renderer.ts
// which implements BridgeRenderer and integrates with createCanonicalRouter.

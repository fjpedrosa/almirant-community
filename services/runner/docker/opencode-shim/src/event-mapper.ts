import type { SSEEvent } from "@almirant/shim-server";

// ---------------------------------------------------------------------------
// OpenCode SSE → normalized SSEEvent mapper
//
// OpenCode's native SSE uses `partType` instead of `contentType` and may send
// `message.part.delta` events where `delta` contains accumulated (snapshot)
// text rather than incremental chunks. This mapper:
//   1. Normalizes `partType` → `contentType`
//   2. Tracks per-part snapshots and extracts only the NEW content as deltas
//   3. Maps `session.idle` / `question.asked` etc. transparently
// ---------------------------------------------------------------------------

export type OpenCodeMappingContext = {
  /** Accumulated text per part ID for delta extraction. */
  partSnapshots: Map<string, string>;
};

export const createMappingContext = (): OpenCodeMappingContext => ({
  partSnapshots: new Map(),
});

type MappingResult = {
  events: SSEEvent[];
};

const asString = (value: unknown): string | undefined =>
  typeof value === "string" && value.length > 0 ? value : undefined;

/** Map OpenCode partType to standard contentType. */
const normalizeContentType = (
  partType: string | undefined,
): "thinking" | "text" | "tool_use" | undefined => {
  if (!partType) return undefined;
  if (partType === "reasoning") return "thinking";
  if (partType === "text" || partType === "thinking" || partType === "tool_use") {
    return partType as "text" | "thinking" | "tool_use";
  }
  return undefined;
};

/**
 * Resolve a part identifier from the event properties.
 * OpenCode uses `partID` (sometimes `partId`) to distinguish parts within
 * the same message. Falls back to `messageID`+`field` composite key.
 */
const resolvePartId = (props: Record<string, unknown>): string => {
  const partId = asString(props.partID) ?? asString(props.partId);
  if (partId) return partId;
  const messageId = asString(props.messageID) ?? asString(props.messageId) ?? "";
  const field = asString(props.field) ?? "text";
  return `${messageId}:${field}`;
};

/** Normalize sessionID → sessionId. */
const resolveSessionId = (props: Record<string, unknown>): string | undefined =>
  asString(props.sessionId) ?? asString(props.sessionID);

export const mapOpenCodeEventToSse = (
  sessionId: string,
  eventType: string,
  props: Record<string, unknown>,
  context: OpenCodeMappingContext,
): MappingResult => {
  switch (eventType) {
    case "message.part.delta": {
      const rawDelta = asString(props.delta);
      if (!rawDelta) return { events: [] };

      const partId = resolvePartId(props);
      const rawPartType = asString(props.partType) ?? asString(props.field);
      const contentType = normalizeContentType(rawPartType) ?? "text";

      // Dedup: compare against previous snapshot for this part.
      // If the delta starts with the previous snapshot, extract only the new portion.
      // If it doesn't, treat it as a full replacement.
      const previous = context.partSnapshots.get(partId) ?? "";

      if (rawDelta.startsWith(previous)) {
        const incrementalDelta = rawDelta.slice(previous.length);
        context.partSnapshots.set(partId, rawDelta);

        if (incrementalDelta.length === 0) {
          // Snapshot unchanged — nothing new to emit
          return { events: [] };
        }

        return {
          events: [
            {
              type: "message.part.delta",
              properties: {
                sessionId,
                delta: incrementalDelta,
                contentType,
              },
            },
          ],
        };
      }

      // Text doesn't start with previous — full replacement
      context.partSnapshots.set(partId, rawDelta);
      return {
        events: [
          {
            type: "message.part.updated",
            properties: {
              sessionId,
              contentType,
              part: { text: rawDelta },
            },
          },
        ],
      };
    }

    case "message.part.updated": {
      // Full snapshot — pass through as-is (sse-canonical-adapter silences these)
      const part = props.part as Record<string, unknown> | undefined;
      const text = part ? asString(part.text) : undefined;
      const rawPartType = asString(props.partType);
      const contentType = normalizeContentType(rawPartType) ?? "text";

      if (text) {
        // Update snapshot tracker so subsequent deltas diff correctly
        const partId = resolvePartId(props);
        context.partSnapshots.set(partId, text);
      }

      return {
        events: [
          {
            type: "message.part.updated",
            properties: {
              sessionId,
              contentType,
              part: { text: text ?? "" },
            },
          },
        ],
      };
    }

    case "session.idle":
    case "session.status": {
      // Check if session.status indicates idle (OpenCode v2 format)
      if (eventType === "session.status") {
        const statusType = asString(props.type);
        if (statusType !== "idle") {
          // Non-idle status — pass through as session.status
          return {
            events: [
              {
                type: "session.status",
                properties: {
                  sessionId,
                  status: statusType ?? "unknown",
                  message: asString(props.message),
                },
              },
            ],
          };
        }
      }

      // Reset snapshot tracker for new turn
      context.partSnapshots.clear();

      return {
        events: [
          {
            type: "session.idle",
            properties: { sessionId },
          },
        ],
      };
    }

    case "question.asked": {
      const text = asString(props.text) ?? asString(props.question) ?? "Input required";
      const options = Array.isArray(props.options)
        ? props.options.map((opt: unknown) => {
            if (typeof opt === "string") return opt;
            if (typeof opt === "object" && opt !== null) {
              const o = opt as Record<string, unknown>;
              const label = asString(o.label) ?? asString(o.value) ?? String(opt);
              const desc = asString(o.description);
              return desc ? `${label}::${desc}` : label;
            }
            return String(opt);
          })
        : [];

      return {
        events: [
          {
            type: "question.asked",
            properties: { sessionId, text, options },
          },
        ],
      };
    }

    case "session.error": {
      const message = asString(props.message) ?? asString(props.error) ?? "OpenCode error";
      return {
        events: [
          {
            type: "session.status",
            properties: { sessionId, status: "error", message },
          },
        ],
      };
    }

    case "server.heartbeat": {
      return {
        events: [
          {
            type: "server.heartbeat",
            properties: { timestamp: new Date().toISOString() },
          },
        ],
      };
    }

    case "server.connected": {
      return {
        events: [
          {
            type: "server.connected",
            properties: { timestamp: new Date().toISOString() },
          },
        ],
      };
    }

    // Events we don't need to forward
    case "session.created":
    case "session.updated":
    case "session.deleted":
    case "session.diff":
    case "message.updated":
    case "message.removed":
    case "message.part.removed":
    case "question.replied":
    case "question.rejected":
    case "permission.asked":
    case "permission.replied":
      return { events: [] };

    default:
      return { events: [] };
  }
};

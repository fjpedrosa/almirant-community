import type { ActivityLogger, ActivityLogEntry } from "@almirant/shared";
import { createWorkItemEvent, createEntityEvent } from "@almirant/database";
import { logger } from "@almirant/config";

/**
 * Work-item event type enum values accepted by the DB.
 * Source: backend/packages/database/src/schema/enums.ts `workItemEventTypeEnum`.
 */
const WORK_ITEM_EVENT_TYPES = new Set([
  "created",
  "updated",
  "moved",
  "deleted",
  "attachment_added",
  "attachment_removed",
  "ai_session",
  "comment",
] as const);

type WorkItemEventType =
  | "created"
  | "updated"
  | "moved"
  | "deleted"
  | "attachment_added"
  | "attachment_removed"
  | "ai_session"
  | "comment";

/**
 * Map a free-form ActivityLogEntry.action to a work_item_events.eventType enum value.
 *
 * Accepts either:
 * - Direct enum values (e.g. "moved", "updated").
 * - Dotted action strings (e.g. "work-item.move", "work-item.update"); the last
 *   segment is matched against the enum with light normalization.
 *
 * Falls back to "updated" to keep the audit trail intact rather than dropping
 * the event. EE can inject a stricter logger if dropping unmapped actions is
 * preferred.
 */
const mapToWorkItemEventType = (action: string): WorkItemEventType => {
  // Direct match on the full action string.
  if (WORK_ITEM_EVENT_TYPES.has(action as WorkItemEventType)) {
    return action as WorkItemEventType;
  }

  const rawTail = action.includes(".") ? action.split(".").pop() ?? "" : action;
  const tail = rawTail.toLowerCase();

  if (WORK_ITEM_EVENT_TYPES.has(tail as WorkItemEventType)) {
    return tail as WorkItemEventType;
  }

  // Common verb -> enum aliases.
  const aliases: Record<string, WorkItemEventType> = {
    create: "created",
    update: "updated",
    edit: "updated",
    move: "moved",
    delete: "deleted",
    remove: "deleted",
  };

  return aliases[tail] ?? "updated";
};

type EntityResourceType = "idea" | "todo" | "seed";

const isEntityResourceType = (value: string): value is EntityResourceType =>
  value === "idea" || value === "todo" || value === "seed";

/**
 * Valid values for the `event_triggered_by` DB enum (see
 * backend/packages/database/src/schema/enums.ts).  Kept in sync manually to
 * avoid a circular dependency on the database package's types.
 */
type TriggeredByValue =
  | "user"
  | "system"
  | "claude-code"
  | "worker"
  | "websocket"
  | "api"
  | "nightly"
  | "mcp";

const TRIGGERED_BY_VALUES: ReadonlySet<TriggeredByValue> = new Set([
  "user",
  "system",
  "claude-code",
  "worker",
  "websocket",
  "api",
  "nightly",
  "mcp",
]);

/**
 * Resolve the `triggeredBy` value for an event from the entry metadata.
 *
 * Call-sites place the originating surface under `metadata.triggeredBy`
 * (e.g. "mcp", "claude-code", "websocket").  We validate it against the DB
 * enum and fall back to "user" for unknown or missing values, preserving
 * the pre-Phase-2 semantics where queries like
 * `WHERE triggered_by = 'mcp'` still return the expected rows.
 */
const resolveTriggeredBy = (
  metadata: Record<string, unknown> | undefined,
): TriggeredByValue => {
  const candidate = metadata?.triggeredBy;
  if (typeof candidate === "string" && TRIGGERED_BY_VALUES.has(candidate as TriggeredByValue)) {
    return candidate as TriggeredByValue;
  }
  return "user";
};

/**
 * Default ActivityLogger for the Community Edition.
 *
 * Routes events to the appropriate repository based on `resourceType`:
 * - "work_item"               -> createWorkItemEvent (typed enum eventType)
 * - "idea" | "todo" | "seed"  -> createEntityEvent  (free-form eventType)
 * - others                    -> logged at debug level, not persisted (future CE work)
 *
 * Semantics are FIRE-AND-FORGET by design (interface contract).
 * Must never throw. DB errors are swallowed after logging a warning.
 *
 * Enterprise Edition can inject a richer logger with retention and audit policy.
 */
export const defaultActivityLogger: ActivityLogger = {
  log(entry: ActivityLogEntry) {
    void (async () => {
      try {
        if (entry.resourceType === "work_item") {
          await createWorkItemEvent({
            workItemId: entry.resourceId,
            eventType: mapToWorkItemEventType(entry.action),
            triggeredBy: resolveTriggeredBy(entry.metadata),
            triggeredByUserId: entry.actorUserId,
            metadata: entry.metadata ?? {},
          });
          return;
        }

        if (isEntityResourceType(entry.resourceType)) {
          await createEntityEvent({
            entityType: entry.resourceType,
            entityId: entry.resourceId,
            eventType: entry.action,
            triggeredBy: resolveTriggeredBy(entry.metadata),
            triggeredByUserId: entry.actorUserId,
            metadata: entry.metadata ?? {},
          });
          return;
        }

        logger.debug({ entry }, "activityLogger: unhandled resourceType (CE)");
      } catch (err) {
        logger.warn({ err, entry }, "activityLogger.log failed (swallowed)");
      }
    })();
  },
};

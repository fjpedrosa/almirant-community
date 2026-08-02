/**
 * Pure, backend-side port of the runner's "is this scheduled agent due right now"
 * policy. Origin: services/runner/src/orchestration/orchestrator.ts
 *   - resolveScheduledDispatchDueKey (~line 130)
 *   - isCronDue / isTimeWindowActive — no longer ported here. Both now live in
 *     `@almirant/shared` (`backend/packages/shared/src/agents/schedule-evaluation.ts`),
 *     which the runner itself imports (`orchestrator.ts:12`). This module
 *     re-exports thin wrappers around those shared functions instead of
 *     keeping a second copy of the policy — two divergent implementations of
 *     "is this due" in the same product is a bug generator.
 *
 * What stays local, and why:
 *   - `resolveScheduledDispatchDueKey`: shared only answers "is it due"
 *     (boolean). This function additionally resolves the SPECIFIC occurrence
 *     timestamp (cron) or 5-minute bucket (time-window) used as an
 *     idempotency key, which requires direct `croner` introspection
 *     (`cron.nextRun` / `cron.previousRuns`) that shared does not expose.
 *     That's a different question than the shared policy answers, not a
 *     duplicate of it.
 *   - `isScheduledAgentRunnable`: gates (`enabled`, `trigger`, `scheduleType
 *     !== "manual"`, `pausedUntil`) that shared's `ScheduleEvaluationInput`
 *     doesn't model at all — shared only knows about schedule *timing*, not
 *     the config's runnability.
 *
 * Every function here is pure: `now` is always passed in explicitly, nothing
 * reaches for `new Date()` or any other ambient state, and nothing throws for
 * expected "not due" outcomes. This module has zero dependency on the runner
 * package — it defines its own minimal structural config type instead of
 * importing `ScheduledAgentConfig` from `@almirant/remote-agent`.
 *
 * Cron matching (for `resolveScheduledDispatchDueKey`'s occurrence lookup)
 * delegates to `croner` (the same library the runner uses — `@almirant/runner`
 * depends on `croner ^10.0.1`), also declared as a direct dependency of
 * `@almirant/api`. There is no bespoke cron parser here.
 */

import { Cron } from "croner";
import {
  isCronDue as sharedIsCronDue,
  isOnceDue as sharedIsOnceDue,
  isTimeWindowActive as sharedIsTimeWindowActive,
  type ScheduleEvaluationInput,
} from "@almirant/shared";

const SCHEDULED_TIME_WINDOW_BUCKET_MS = 5 * 60 * 1000;

export type ScheduledAgentDueTrigger = "scheduled" | "webhook" | (string & {});
export type ScheduledAgentDueScheduleType = "cron" | "time_window" | "once" | "manual" | (string & {});

export type CronScheduleConfigLike = {
  expression: string;
};

export type TimeWindowScheduleConfigLike = {
  startHour: number;
  endHour: number;
  daysOfWeek?: number[] | null;
};

export type OnceScheduleConfigLike = {
  runAt: string; // ISO-8601 timestamp
};

/**
 * Minimal structural type for the `targetConfig` modes that bypass the
 * cooldown gate in `isTimeWindowActive`. Only the `enabled` flag is needed
 * here — the rest of each mode's shape is irrelevant to this module.
 */
export type ScheduledAgentDueTargetConfigLike = {
  backlogDrain?: { enabled?: boolean } | null;
  dodRemediation?: { enabled?: boolean } | null;
  dodReview?: { enabled?: boolean } | null;
  releaseIntegration?: { enabled?: boolean } | null;
};

/**
 * Minimal structural type for the fields this module needs. Deliberately not
 * imported from the runner or from `@almirant/database` — any object shaped
 * like this (a Drizzle row, a wire DTO, a hand-built test fixture) satisfies
 * it via duck typing. `enabled` and `trigger` are additive to the field list
 * given in the task brief (configId, name, scheduleType, scheduleConfig,
 * timezone, lastRunAt, pausedUntil) because `isScheduledAgentRunnable` gates
 * on them explicitly.
 */
export type ScheduledAgentDueConfig = {
  configId: string;
  name: string;
  enabled: boolean;
  trigger: ScheduledAgentDueTrigger;
  scheduleType: ScheduledAgentDueScheduleType;
  scheduleConfig:
    | CronScheduleConfigLike
    | TimeWindowScheduleConfigLike
    | OnceScheduleConfigLike
    | Record<string, unknown>
    | null;
  timezone: string;
  lastRunAt?: string | Date | null;
  pausedUntil?: string | Date | null;
  targetConfig?: ScheduledAgentDueTargetConfigLike | null;
};

export type ScheduledDispatchDueResult =
  | { due: false }
  | { due: true; dueKey: string };

const toDate = (value: string | Date | null | undefined): Date | null => {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
};

/**
 * Adapts our locally-scoped config shape to shared's minimal
 * `ScheduleEvaluationInput`. The extra fields on `ScheduledAgentDueConfig`
 * (`configId`, `name`, `enabled`, `trigger`, `pausedUntil`) exist only for
 * `isScheduledAgentRunnable` below — shared's schedule-timing policy doesn't
 * need them.
 */
const toScheduleEvaluationInput = (config: ScheduledAgentDueConfig): ScheduleEvaluationInput => ({
  scheduleType: config.scheduleType,
  scheduleConfig: config.scheduleConfig,
  timezone: config.timezone,
  lastRunAt: config.lastRunAt,
  targetConfig: config.targetConfig,
});

// ---------------------------------------------------------------------------
// Shared policy — thin delegation, no local re-implementation.
// ---------------------------------------------------------------------------

/** Delegates to `@almirant/shared`'s `isCronDue` — see that module for the policy itself. */
export const isCronDue = (config: ScheduledAgentDueConfig, now: Date): boolean =>
  sharedIsCronDue(toScheduleEvaluationInput(config), now);

/** Delegates to `@almirant/shared`'s `isTimeWindowActive` — see that module for the policy itself. */
export const isTimeWindowActive = (config: ScheduledAgentDueConfig, now: Date): boolean =>
  sharedIsTimeWindowActive(toScheduleEvaluationInput(config), now);

/** Delegates to `@almirant/shared`'s `isOnceDue` — see that module for the policy itself. */
export const isOnceDue = (config: ScheduledAgentDueConfig, now: Date): boolean =>
  sharedIsOnceDue(toScheduleEvaluationInput(config), now);

/**
 * Port of `resolveScheduledDispatchDueKey` (orchestrator.ts:121). Unlike the
 * origin, this NEVER throws when no occurrence is due — it returns
 * `{ due: false }` instead, since a sweeper iterating many configs should not
 * have one bad config abort the batch.
 *
 * 'once' (community issue #91): the due key is derived from the canonicalized
 * `runAt` timestamp itself, not from `now` — every replay of the SAME
 * occurrence (concurrent dispatch authorities, or a retried tick before the
 * auto-disable lands) computes the identical `dueKey`, so the existing
 * (configId, dueKey) reservation in `reserveScheduledAgentRun` makes two
 * concurrent dispatches collapse into one job, exactly like `cron:<occurrence>`
 * does for cron.
 */
export const resolveScheduledDispatchDueKey = (
  config: ScheduledAgentDueConfig,
  now: Date,
): ScheduledDispatchDueResult => {
  if (config.scheduleType === "cron") {
    try {
      const cronConfig = config.scheduleConfig as CronScheduleConfigLike;
      const cron = new Cron(cronConfig.expression, { timezone: config.timezone });

      const lastRun = toDate(config.lastRunAt);
      const occurrence = lastRun ? cron.nextRun(lastRun) : (cron.previousRuns(1, now)[0] ?? null);

      if (!occurrence || occurrence > now) {
        return { due: false };
      }
      return { due: true, dueKey: `cron:${occurrence.toISOString()}` };
    } catch {
      return { due: false };
    }
  }

  if (config.scheduleType === "once") {
    const onceConfig = config.scheduleConfig as OnceScheduleConfigLike | null;
    const runAt = onceConfig ? toDate(onceConfig.runAt) : null;
    if (!runAt || runAt.getTime() > now.getTime()) {
      return { due: false };
    }
    return { due: true, dueKey: `once:${runAt.toISOString()}` };
  }

  const bucketStart =
    Math.floor(now.getTime() / SCHEDULED_TIME_WINDOW_BUCKET_MS) * SCHEDULED_TIME_WINDOW_BUCKET_MS;
  return { due: true, dueKey: `time-window:${new Date(bucketStart).toISOString()}` };
};

/**
 * New gate centralizing checks that today are scattered across the runner
 * loop and the dispatch endpoint (workers.routes.ts): `enabled`,
 * `trigger === "scheduled"`, `scheduleType !== "manual"`, and `pausedUntil`
 * in the future. The runner's scheduler loop never applied the `pausedUntil`
 * gate — only the dispatch endpoint did — so a paused scheduled config could
 * still be evaluated (and its due-key computed) by the runner sweep. This
 * function closes that gap for backend callers.
 */
export const isScheduledAgentRunnable = (config: ScheduledAgentDueConfig, now: Date): boolean => {
  if (!config.enabled) return false;
  if (config.trigger !== "scheduled") return false;
  if (config.scheduleType === "manual") return false;

  const pausedUntil = toDate(config.pausedUntil);
  if (pausedUntil && pausedUntil.getTime() > now.getTime()) return false;

  return true;
};

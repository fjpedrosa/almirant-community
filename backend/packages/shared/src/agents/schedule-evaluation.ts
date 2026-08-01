import { Cron } from "croner";
import {
  resolveEnabledBuiltinAutomation,
  type BuiltinAutomationTargetFlags,
} from "./builtin-automations";

/**
 * Schedule evaluation for scheduled agent configs.
 *
 * This lives in shared because two callers need the same answer and must not
 * disagree:
 *
 *  - The runner, which polls `/workers/scheduled-configs` and dispatches the
 *    configs that are due. It is the only component that actually fires them.
 *  - The API's latent-demand endpoint, which the scaler uses to decide whether
 *    it is worth booting a runner at all. If it said "due" when the runner
 *    would not fire, the scaler would boot a runner that immediately idles out;
 *    if it said "not due" when the runner would, agents would never run under
 *    scale-to-zero.
 */

export type CronScheduleConfigLike = {
  expression: string;
};

export type TimeWindowScheduleConfigLike = {
  startHour: number;
  endHour: number;
  daysOfWeek?: number[];
};

/** The four built-in-automation targetConfig flags — re-exported alias of
 *  the catalog's shape so this file's public types are unaffected. */
type BuiltinTargetFlags = BuiltinAutomationTargetFlags;

export type ScheduleEvaluationInput = {
  scheduleType: string;
  scheduleConfig: unknown;
  timezone: string;
  lastRunAt?: string | Date | null;
  targetConfig?: BuiltinTargetFlags | null;
};

/** Time-window configs skip the cooldown for reconciler-style automations. */
const TIME_WINDOW_COOLDOWN_MS = 5 * 60 * 1000;

const toDate = (value: string | Date | null | undefined): Date | null => {
  if (!value) return null;
  return value instanceof Date ? value : new Date(value);
};

const isBuiltinReconciler = (targetConfig: BuiltinTargetFlags | null | undefined): boolean =>
  resolveEnabledBuiltinAutomation(targetConfig) !== undefined;

/**
 * A cron config is due when the next occurrence after its last run has already
 * passed. A config that has never run is always due. An unparseable expression
 * is treated as not due — the runner logs and skips it rather than firing on
 * every tick.
 */
export const isCronDue = (config: ScheduleEvaluationInput, now: Date): boolean => {
  const cronConfig = config.scheduleConfig as CronScheduleConfigLike | null;
  if (!cronConfig?.expression) return false;

  try {
    const job = new Cron(cronConfig.expression, { timezone: config.timezone });
    const lastRun = toDate(config.lastRunAt);
    if (lastRun) {
      const nextRun = job.nextRun(lastRun);
      if (!nextRun || nextRun > now) return false;
    }
    return true;
  } catch {
    return false;
  }
};

/**
 * A time-window config is active inside its hour range on an allowed weekday.
 * Built-in reconcilers may run on every tick — candidate selection subtracts
 * active jobs from each project's concurrency before creating new ones — so
 * only prompt-style agents get the cooldown.
 */
export const isTimeWindowActive = (
  config: ScheduleEvaluationInput,
  now: Date,
): boolean => {
  const scheduleConfig = config.scheduleConfig as TimeWindowScheduleConfigLike | null;
  if (!scheduleConfig) return false;

  const dateInTz = new Intl.DateTimeFormat("en-US", {
    timeZone: config.timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
  const currentDayOfWeek = new Date(dateInTz).getDay();

  if (
    scheduleConfig.daysOfWeek &&
    scheduleConfig.daysOfWeek.length > 0 &&
    !scheduleConfig.daysOfWeek.includes(currentDayOfWeek)
  ) {
    return false;
  }

  const currentHour = parseInt(
    new Intl.DateTimeFormat("en-US", {
      timeZone: config.timezone,
      hour: "numeric",
      hour12: false,
    }).format(now),
    10,
  );

  const inWindow =
    scheduleConfig.startHour <= scheduleConfig.endHour
      ? currentHour >= scheduleConfig.startHour && currentHour < scheduleConfig.endHour
      : // Wrap-around (e.g. startHour=22, endHour=6)
        currentHour >= scheduleConfig.startHour || currentHour < scheduleConfig.endHour;

  if (!inWindow) return false;
  if (isBuiltinReconciler(config.targetConfig)) return true;

  const lastRun = toDate(config.lastRunAt);
  if (lastRun && now.getTime() - lastRun.getTime() < TIME_WINDOW_COOLDOWN_MS) {
    return false;
  }

  return true;
};

/** Whether the runner would fire this config right now. */
export const isScheduleDue = (config: ScheduleEvaluationInput, now: Date): boolean =>
  config.scheduleType === "cron"
    ? isCronDue(config, now)
    : isTimeWindowActive(config, now);

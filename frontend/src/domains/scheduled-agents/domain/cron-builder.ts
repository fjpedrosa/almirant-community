export type GuidedCronMode = "interval" | "hourly" | "daily" | "weekly";

export interface GuidedCronConfig {
  mode: GuidedCronMode;
  intervalMinutes?: number;
  hour?: number;
  minute?: number;
  daysOfWeek?: number[];
}

export const GUIDED_CRON_INTERVAL_OPTIONS = [5, 15, 30] as const;
export const GUIDED_CRON_MINUTE_OPTIONS = [0, 15, 30, 45] as const;

const isIntegerInRange = (
  value: number | undefined,
  min: number,
  max: number,
): value is number => typeof value === "number" && Number.isInteger(value) && value >= min && value <= max;

const normalizeDays = (daysOfWeek: number[] | undefined) => {
  if (!daysOfWeek || daysOfWeek.length === 0) {
    return [];
  }

  return [...new Set(daysOfWeek)]
    .filter((day) => Number.isInteger(day) && day >= 0 && day <= 6)
    .sort((left, right) => left - right);
};

export const buildCronExpression = (config: GuidedCronConfig): string | null => {
  if (config.mode === "hourly") {
    return "0 * * * *";
  }

  if (config.mode === "interval") {
    if (
      !config.intervalMinutes ||
      !GUIDED_CRON_INTERVAL_OPTIONS.includes(
        config.intervalMinutes as (typeof GUIDED_CRON_INTERVAL_OPTIONS)[number],
      )
    ) {
      return null;
    }

    return `*/${config.intervalMinutes} * * * *`;
  }

  if (!isIntegerInRange(config.hour, 0, 23) || !isIntegerInRange(config.minute, 0, 59)) {
    return null;
  }

  if (config.mode === "daily") {
    return `${config.minute} ${config.hour} * * *`;
  }

  const normalizedDays = normalizeDays(config.daysOfWeek);
  if (normalizedDays.length === 0) {
    return null;
  }

  return `${config.minute} ${config.hour} * * ${normalizedDays.join(",")}`;
};

export const parseGuidedCronExpression = (expression: string): GuidedCronConfig | null => {
  const normalized = expression.trim();

  const intervalMatch = normalized.match(/^\*\/(\d{1,2}) \* \* \* \*$/);
  if (intervalMatch) {
    const intervalMinutes = Number(intervalMatch[1]);
    if (
      GUIDED_CRON_INTERVAL_OPTIONS.includes(
        intervalMinutes as (typeof GUIDED_CRON_INTERVAL_OPTIONS)[number],
      )
    ) {
      return { mode: "interval", intervalMinutes };
    }
    return null;
  }

  if (normalized === "0 * * * *") {
    return { mode: "hourly" };
  }

  const dailyMatch = normalized.match(/^(\d{1,2}) (\d{1,2}) \* \* \*$/);
  if (dailyMatch) {
    const minute = Number(dailyMatch[1]);
    const hour = Number(dailyMatch[2]);
    if (isIntegerInRange(hour, 0, 23) && isIntegerInRange(minute, 0, 59)) {
      return { mode: "daily", hour, minute };
    }
    return null;
  }

  const weeklyMatch = normalized.match(/^(\d{1,2}) (\d{1,2}) \* \* ([0-6](?:,[0-6])*)$/);
  if (weeklyMatch) {
    const minute = Number(weeklyMatch[1]);
    const hour = Number(weeklyMatch[2]);
    const daysOfWeek = weeklyMatch[3].split(",").map(Number);

    if (isIntegerInRange(hour, 0, 23) && isIntegerInRange(minute, 0, 59)) {
      return {
        mode: "weekly",
        hour,
        minute,
        daysOfWeek: normalizeDays(daysOfWeek),
      };
    }
  }

  return null;
};

export const isGuidedCronConfig = (expression: string): boolean =>
  parseGuidedCronExpression(expression) !== null;

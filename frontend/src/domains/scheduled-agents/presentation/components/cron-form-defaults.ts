import type { GuidedCronMode } from "../../domain/cron-builder";

export const DEFAULT_CRON_EXPRESSION = "0 9 * * 1,2,3,4,5";

export const resolveCronFormActiveMode = ({
  expression,
  parsedMode,
}: {
  expression: string | null | undefined;
  parsedMode?: GuidedCronMode;
}): GuidedCronMode | "custom" => {
  if (parsedMode) {
    return parsedMode;
  }

  return (expression?.trim() ?? "").length > 0 ? "custom" : "weekly";
};

export const resolveDefaultCronExpression = ({
  scheduleType,
  cronExpression,
}: {
  scheduleType: "manual" | "time_window" | "cron";
  cronExpression: string | null | undefined;
}): string | null => {
  if (scheduleType !== "cron") {
    return null;
  }

  const normalizedExpression = cronExpression?.trim() ?? "";
  return normalizedExpression.length > 0 ? normalizedExpression : DEFAULT_CRON_EXPRESSION;
};

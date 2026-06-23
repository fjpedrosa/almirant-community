import type { PacingResult } from "./types";

const PACE_TOLERANCE_PERCENT = 5;

const toPercent = (utilization: number): number => {
  return utilization <= 1 ? utilization * 100 : utilization;
};

const clamp = (value: number, min: number, max: number): number => {
  return Math.min(max, Math.max(min, value));
};

export const calculatePacing = (
  utilization: number,
  resetsAt: string,
  periodHours: number,
): PacingResult => {
  const actualPercent = toPercent(utilization);

  if (!Number.isFinite(periodHours) || periodHours <= 0) {
    return {
      expectedPercent: 0,
      actualPercent,
      deviationPercent: actualPercent,
      status: actualPercent > PACE_TOLERANCE_PERCENT ? "ahead" : "on-track",
    };
  }

  const resetsAtMs = new Date(resetsAt).getTime();
  const hoursUntilReset = Number.isFinite(resetsAtMs)
    ? Math.max(0, (resetsAtMs - Date.now()) / (60 * 60 * 1000))
    : 0;
  const elapsedHours = clamp(periodHours - hoursUntilReset, 0, periodHours);
  const expectedPercent = clamp((elapsedHours / periodHours) * 100, 0, 100);
  const deviationPercent = actualPercent - expectedPercent;

  if (deviationPercent > PACE_TOLERANCE_PERCENT) {
    return {
      expectedPercent,
      actualPercent,
      deviationPercent,
      status: "ahead",
    };
  }

  if (deviationPercent < -PACE_TOLERANCE_PERCENT) {
    return {
      expectedPercent,
      actualPercent,
      deviationPercent,
      status: "behind",
    };
  }

  return {
    expectedPercent,
    actualPercent,
    deviationPercent,
    status: "on-track",
  };
};

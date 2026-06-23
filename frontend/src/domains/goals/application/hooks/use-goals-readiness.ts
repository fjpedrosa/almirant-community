"use client";

import { useMemo } from "react";
import { MVP_LAUNCH_GOAL_DATA } from "../../domain/mvp-readiness-data";
import type {
  GoalLaunchTodoItem,
  GoalReadinessByBlock,
  GoalsMeetingPageProps,
} from "../../domain/types";

const clamp = (value: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, value));

const startOfDay = (value: Date): Date =>
  new Date(value.getFullYear(), value.getMonth(), value.getDate());

const differenceInDays = (from: Date, to: Date): number => {
  const msPerDay = 1000 * 60 * 60 * 24;
  const fromDay = startOfDay(from).getTime();
  const toDay = startOfDay(to).getTime();
  return Math.round((toDay - fromDay) / msPerDay);
};

const toIsoDate = (value: Date): string => value.toISOString().slice(0, 10);

const weightedProgress = (items: GoalLaunchTodoItem[]): number => {
  if (items.length === 0) return 0;
  const totalWeight = items.reduce((sum, item) => sum + item.weight, 0);
  if (totalWeight === 0) return 0;

  const completedWeight = items.reduce(
    (sum, item) => sum + item.weight * (clamp(item.progress, 0, 100) / 100),
    0
  );
  return Math.round((completedWeight / totalWeight) * 100);
};

const computeBlockReadiness = (items: GoalLaunchTodoItem[]): GoalReadinessByBlock[] => {
  const labels: Record<GoalReadinessByBlock["block"], string> = {
    A: "Bloque A",
    B: "Bloque B",
    C: "Bloque C",
  };

  return (["A", "B", "C"] as const).map((block) => {
    const blockItems = items.filter((item) => item.block === block);
    const totalWeight = blockItems.reduce((sum, item) => sum + item.weight, 0);
    const progress = weightedProgress(blockItems);
    return {
      block,
      label: labels[block],
      progress,
      totalWeight,
    };
  });
};

export const useGoalsReadiness = (): GoalsMeetingPageProps => {
  const {
    goalTitle,
    goalDescription,
    startDate,
    targetDate,
    lastUpdated,
    successCriteria,
    measurementNotes,
    readinessAreas,
    todoItems,
  } = MVP_LAUNCH_GOAL_DATA;

  const requiredItems = useMemo(
    () => todoItems.filter((item) => item.requiredForLaunch),
    [todoItems]
  );
  const optionalItems = useMemo(
    () => todoItems.filter((item) => !item.requiredForLaunch),
    [todoItems]
  );

  const launchProgress = useMemo(() => weightedProgress(requiredItems), [requiredItems]);

  const { expectedProgress, daysRemaining, elapsedDays } = useMemo(() => {
    const today = new Date();
    const start = new Date(startDate);
    const target = new Date(targetDate);
    const totalDays = Math.max(1, differenceInDays(start, target));
    const elapsed = clamp(differenceInDays(start, today), 0, totalDays);

    return {
      expectedProgress: Math.round((elapsed / totalDays) * 100),
      daysRemaining: differenceInDays(today, target),
      elapsedDays: elapsed,
    };
  }, [startDate, targetDate]);

  const progressDelta = launchProgress - expectedProgress;

  const projectedFinishDate = useMemo(() => {
    if (launchProgress <= 0) return null;

    const effectiveElapsed = Math.max(elapsedDays, 0.5);
    const dailyRate = launchProgress / effectiveElapsed;
    if (dailyRate <= 0) return null;

    const remaining = Math.max(0, 100 - launchProgress);
    const daysToFinish = Math.ceil(remaining / dailyRate);
    const projectedDate = new Date();
    projectedDate.setDate(projectedDate.getDate() + daysToFinish);
    return toIsoDate(projectedDate);
  }, [elapsedDays, launchProgress]);

  const blockedItems = useMemo(
    () => requiredItems.filter((item) => item.status === "blocked").length,
    [requiredItems]
  );

  const highRiskItems = useMemo(
    () => requiredItems.filter((item) => item.risk === "high").length,
    [requiredItems]
  );

  const readinessByBlock = useMemo(
    () => computeBlockReadiness(requiredItems),
    [requiredItems]
  );

  const healthLabel = useMemo(() => {
    if (blockedItems > 0 || progressDelta < -10) return "Riesgo alto";
    if (highRiskItems > 0 || progressDelta < 0) return "Atencion";
    return "En ritmo";
  }, [blockedItems, highRiskItems, progressDelta]);

  return {
    goalTitle,
    goalDescription,
    startDate,
    targetDate,
    lastUpdated,
    successCriteria,
    measurementNotes,
    readinessAreas,
    todoItems,
    requiredItems,
    optionalItems,
    readinessByBlock,
    launchProgress,
    expectedProgress,
    progressDelta,
    daysRemaining,
    blockedItems,
    highRiskItems,
    projectedFinishDate,
    healthLabel,
  };
};

import { z } from "zod";
import { canonicalJson, sha256Utf8 } from "./canonical-json";
import { durationV1Schema } from "./duration-calibration-policy";

const identifier = z.string().min(1).max(200).regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/);
const boundedText = (max: number) => z.string().min(1).max(max);
const prioritySchema = z.enum(["low", "medium", "high", "urgent"]);
const workUnitSizeSchema = z.enum(["XS", "S", "M", "L", "XL"]);

const workUnitV1Schema = z.object({
  kind: z.literal("work_unit"),
  tempId: identifier,
  title: boundedText(500),
  description: boundedText(20_000).optional(),
  priority: prioritySchema,
  work_unit_size: workUnitSizeSchema,
  duration: durationV1Schema.optional(),
  acceptance: z.array(boundedText(5_000)).min(1).max(100),
  dependencies: z.array(identifier).max(500),
  rollbackBoundary: boundedText(1_000).optional(),
  reviewBudgetLines: z.number().int().positive().optional(),
}).strict();

const featureV1Schema = z.object({
  kind: z.literal("feature"),
  tempId: identifier,
  title: boundedText(500),
  description: boundedText(20_000).optional(),
  acceptance: z.array(boundedText(5_000)).max(100).optional(),
  workUnits: z.array(workUnitV1Schema).min(1).max(500),
}).strict();

const planV1Schema = z.object({
  version: z.literal(1),
  kind: z.literal("plan"),
  title: boundedText(500),
  target: z.object({ projectId: identifier, boardId: identifier }).strict(),
  features: z.array(featureV1Schema).max(500),
  workUnits: z.array(workUnitV1Schema).max(500),
}).strict().superRefine((plan, context) => {
  const workUnits = [
    ...plan.workUnits.map((unit, index) => ({ unit, path: ["workUnits", index] })),
    ...plan.features.flatMap((feature, featureIndex) => feature.workUnits.map((unit, index) => ({
      unit,
      path: ["features", featureIndex, "workUnits", index],
    }))),
  ];
  if (workUnits.length === 0) {
    context.addIssue({ code: "custom", path: ["workUnits"], message: "A Plan requires at least one Work Unit." });
  }

  const allIds = new Set<string>();
  for (const [index, feature] of plan.features.entries()) {
    if (allIds.has(feature.tempId)) {
      context.addIssue({ code: "custom", path: ["features", index, "tempId"], message: "Plan tempIds must be unique." });
    }
    allIds.add(feature.tempId);
  }

  const workUnitIds = new Set<string>();
  for (const { unit, path } of workUnits) {
    if (allIds.has(unit.tempId)) {
      context.addIssue({ code: "custom", path: [...path, "tempId"], message: "Plan tempIds must be unique." });
    }
    allIds.add(unit.tempId);
    workUnitIds.add(unit.tempId);
  }

  const dependencies = new Map<string, string[]>();
  for (const { unit, path } of workUnits) {
    dependencies.set(unit.tempId, unit.dependencies);
    const seen = new Set<string>();
    for (const [index, dependency] of unit.dependencies.entries()) {
      const dependencyPath = [...path, "dependencies", index];
      if (!workUnitIds.has(dependency)) {
        context.addIssue({ code: "custom", path: dependencyPath, message: "Dependencies must reference a Work Unit in the same Plan." });
      }
      if (dependency === unit.tempId) {
        context.addIssue({ code: "custom", path: dependencyPath, message: "A Work Unit cannot depend on itself." });
      }
      if (seen.has(dependency)) {
        context.addIssue({ code: "custom", path: dependencyPath, message: "Work Unit dependencies must be unique." });
      }
      seen.add(dependency);
    }
  }

  const visit = (tempId: string, visiting: Set<string>, visited: Set<string>): boolean => {
    if (visiting.has(tempId)) return true;
    if (visited.has(tempId)) return false;
    visiting.add(tempId);
    const cyclic = (dependencies.get(tempId) ?? []).some((dependency) =>
      workUnitIds.has(dependency) && visit(dependency, visiting, visited));
    visiting.delete(tempId);
    visited.add(tempId);
    return cyclic;
  };
  const visited = new Set<string>();
  if ([...workUnitIds].some((tempId) => visit(tempId, new Set(), visited))) {
    context.addIssue({ code: "custom", path: ["workUnits"], message: "Work Unit dependencies cannot contain cycles." });
  }
});

export type WorkUnitSize = z.infer<typeof workUnitSizeSchema>;
export type WorkUnitV1 = z.infer<typeof workUnitV1Schema>;
export type FeatureV1 = z.infer<typeof featureV1Schema>;
export type PlanV1 = z.infer<typeof planV1Schema>;
export type CanonicalPlanV1 = { content: string; sha256: string };

export const parsePlanV1 = (input: unknown): PlanV1 => planV1Schema.parse(input);

export const canonicalizePlanV1 = (input: unknown): CanonicalPlanV1 => {
  const content = canonicalJson(parsePlanV1(input));
  return { content, sha256: sha256Utf8(content) };
};

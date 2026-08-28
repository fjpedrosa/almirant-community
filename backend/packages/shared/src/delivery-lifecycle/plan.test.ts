import { describe, expect, it } from "bun:test";
import { canonicalizePlanV1, parsePlanV1 } from "./plan";

const workUnit = {
  kind: "work_unit" as const,
  tempId: "wu-1",
  title: "Ship the parser",
  priority: "high" as const,
  work_unit_size: "M" as const,
  acceptance: ["The point-free contract is enforced."],
  dependencies: [] as string[],
};

const directPlan = () => ({
  version: 1 as const,
  kind: "plan" as const,
  title: "Delivery plan",
  target: { projectId: "project-1", boardId: "board-1" },
  features: [],
  workUnits: [{ ...workUnit }],
});

const featuredPlan = () => ({
  ...directPlan(),
  features: [{
    kind: "feature" as const,
    tempId: "feature-1",
    title: "Plan authority",
    workUnits: [{
      ...workUnit,
      duration: {
        minMinutes: 30,
        maxMinutes: 90,
        calibration: "uncalibrated" as const,
        calibrationPolicyVersion: "duration-calibration/v1" as const,
      },
    }],
  }],
  workUnits: [],
});

describe("Plan V1 point-free contract", () => {
  it("accepts direct and one-Feature Work Unit shapes", () => {
    expect(parsePlanV1(directPlan()).workUnits[0]?.tempId).toBe("wu-1");
    expect(parsePlanV1(featuredPlan()).features[0]?.workUnits[0]?.duration).toEqual({
      minMinutes: 30,
      maxMinutes: 90,
      calibration: "uncalibrated",
      calibrationPolicyVersion: "duration-calibration/v1",
    });
  });

  it("rejects empty, point-bearing, XXL, and nested public hierarchy", () => {
    const nested = featuredPlan() as unknown as { features: Array<{ workUnits: unknown[] }> };
    nested.features[0]!.workUnits = [{ kind: "feature", tempId: "nested", title: "Nested", workUnits: [] }];
    const invalid = [
      { ...directPlan(), workUnits: [] },
      { ...directPlan(), workUnits: [{ ...workUnit, points: 5 }] },
      { ...directPlan(), workUnits: [{ ...workUnit, work_unit_size: "XXL" }] },
      { ...directPlan(), futurePolicy: true },
      nested,
    ];

    for (const candidate of invalid) expect(() => parsePlanV1(candidate)).toThrow();
  });

  it("rejects missing and cyclic Work Unit dependencies", () => {
    const invalid = [
      { ...directPlan(), workUnits: [{ ...workUnit, dependencies: ["missing"] }] },
      { ...directPlan(), workUnits: [{ ...workUnit, dependencies: ["wu-1"] }] },
      { ...directPlan(), workUnits: [
        { ...workUnit, dependencies: ["wu-2", "wu-2"] },
        { ...workUnit, tempId: "wu-2" },
      ] },
      { ...directPlan(), workUnits: [
        { ...workUnit, dependencies: ["wu-2"] },
        { ...workUnit, tempId: "wu-2", dependencies: ["wu-1"] },
      ] },
    ];

    for (const candidate of invalid) expect(() => parsePlanV1(candidate)).toThrow();
  });

  it("rejects invalid ranges and client-forged calibration", () => {
    for (const duration of [
      { minMinutes: 90, maxMinutes: 30, calibration: "uncalibrated", calibrationPolicyVersion: "duration-calibration/v1" },
      { minMinutes: 30, maxMinutes: 90, calibration: "calibrated", calibrationPolicyVersion: "duration-calibration/v1" },
      { minMinutes: 30, maxMinutes: 90, calibration: "uncalibrated", calibrationPolicyVersion: "client-policy/v1" },
    ]) {
      expect(() => parsePlanV1({
        ...directPlan(),
        workUnits: [{ ...workUnit, duration }],
      })).toThrow();
    }
  });

  it("emits key-order-independent canonical JSON and a pinned SHA-256 identity", () => {
    const canonical = canonicalizePlanV1(directPlan());
    const reordered = canonicalizePlanV1({
      workUnits: directPlan().workUnits,
      features: [],
      target: { boardId: "board-1", projectId: "project-1" },
      title: "Delivery plan",
      kind: "plan",
      version: 1,
    });

    expect(canonical).toEqual(reordered);
    expect(canonical.sha256).toBe("447b4257176da898ee45dc206ababaff167b7c2dceb3a3939479826c2214647b");
    expect(canonical).not.toHaveProperty("revision");
  });
});

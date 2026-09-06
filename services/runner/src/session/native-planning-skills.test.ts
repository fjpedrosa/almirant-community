import { describe, expect, it } from "bun:test";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
  MAX_NATIVE_PLAN_V1_OUTPUT_CHARS,
  NATIVE_PLAN_V1_MARKER,
  parsePlanV1,
} from "@almirant/shared";

const ROOT = resolve(import.meta.dir, "../../../..");
const readRoot = (path: string) => readFile(resolve(ROOT, path), "utf8");
const skillPaths = ["ideate", "create-tasks", "refine"] as const;

const requiredNativeRules = [
  'planningContract: "plan-v1"',
  NATIVE_PLAN_V1_MARKER,
  "targetless Plan V1 JSON object",
  "XS, S, M, L, or XL",
  "acceptance",
  "dependencies",
  "duration-calibration/v1",
  "structured question",
  "no plain assistant clarification or progress text",
  "Do not call create, update, dependency, acceptance, persistence, or memory-write tools",
  "Do not fabricate unavailable facts or statuses",
];

describe("native Plan protocol", () => {
  it("publishes one stable Shared marker and output bound with WU06a aliases", async () => {
    expect(NATIVE_PLAN_V1_MARKER).toBe("<<<ALMIRANT:NATIVE_PLAN_V1>>>");
    expect(MAX_NATIVE_PLAN_V1_OUTPUT_CHARS).toBe(65_536);

    const apiSource = await readRoot("backend/api/src/domains/ai/shared/services/native-plan-generation.ts");
    expect(apiSource).toContain("NATIVE_PLAN_V1_MARKER as NATIVE_PLAN_MARKER");
    expect(apiSource).toContain("MAX_NATIVE_PLAN_V1_OUTPUT_CHARS as MAX_NATIVE_PLAN_OUTPUT_CHARS");
  });

  it("makes native output conditional, targetless, structured, and side-effect free", async () => {
    for (const name of skillPaths) {
      const skill = await readRoot(`.agents/skills/${name}/SKILL.md`);
      for (const rule of requiredNativeRules) expect(skill).toContain(rule);
      expect(skill).toContain("direct, featured, or mixed");
    }
  });

  it("describes valid direct, featured, and mixed XS–XL draft shapes", () => {
    const sizes = ["XS", "S", "M", "L", "XL"] as const;
    const units = sizes.map((size, index) => ({
      kind: "work_unit",
      tempId: `wu-${size.toLowerCase()}`,
      title: `${size} unit`,
      priority: "medium",
      work_unit_size: size,
      acceptance: [`${size} is accepted`],
      dependencies: index === 0 ? [] : [`wu-${sizes[index - 1]!.toLowerCase()}`],
      ...(size === "XL" ? { duration: {
        minMinutes: 60, maxMinutes: 120, calibration: "uncalibrated",
        calibrationPolicyVersion: "duration-calibration/v1",
      } } : {}),
    }));
    const drafts = [
      { features: [], workUnits: units },
      { features: [{ kind: "feature", tempId: "feature-1", title: "Feature", workUnits: units }], workUnits: [] },
      { features: [{ kind: "feature", tempId: "feature-1", title: "Feature", workUnits: units.slice(2) }], workUnits: units.slice(0, 2) },
    ];

    for (const draft of drafts) {
      expect(Object.hasOwn(draft, "target")).toBe(false);
      const parsed = parsePlanV1({
        version: 1, kind: "plan", title: "Native draft", ...draft,
        target: { projectId: "project-1", boardId: "board-1" },
      });
      const parsedUnits = [...parsed.workUnits, ...parsed.features.flatMap((feature) => feature.workUnits)];
      expect(parsedUnits.map((unit) => unit.work_unit_size)).toEqual([...sizes]);
      expect(parsedUnits.at(-1)?.duration?.calibration).toBe("uncalibrated");
    }
  });

  it("fails refine closed outside exactly one immediate targetless candidate", async () => {
    const refine = await readRoot(".agents/skills/refine/SKILL.md");
    for (const rule of [
      "current request or the immediately prior assistant message",
      "exactly one candidate across those two messages",
      "older, multiple, malformed, or target-bearing",
      "emit nothing and mutate nothing",
    ]) expect(refine).toContain(rule);
  });
});

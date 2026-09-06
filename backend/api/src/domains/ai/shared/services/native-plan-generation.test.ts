import { describe, expect, it } from "bun:test";
import {
  MAX_NATIVE_PLAN_OUTPUT_CHARS, NATIVE_PLAN_MARKER,
  buildNativePlanningSnapshot, parseNativePlanOutput,
} from "./native-plan-generation";

const workUnit = {
  kind: "work_unit", tempId: "wu-1", title: "Implement boundary", priority: "high",
  work_unit_size: "M", acceptance: ["The native draft validates"], dependencies: [],
};
const feature = { kind: "feature", tempId: "feature-1", title: "Feature", workUnits: [{ ...workUnit, tempId: "wu-feature" }] };
const draft = { version: 1, kind: "plan", title: "Ship native planning", features: [], workUnits: [workUnit] };
const marked = (value: unknown) => `${NATIVE_PLAN_MARKER}\n${JSON.stringify(value)}`;
const target = { projectId: "project-1", boardId: "board-1" };
const scope = {
  workspaceId: "workspace-1", sessionWorkspaceId: "workspace-1", requestedByUserId: "user-1",
  projectId: target.projectId, boardId: target.boardId,
};
const enabled = async (): Promise<boolean> => true;

describe("native Plan generation boundary", () => {
  it("snapshots the server-owned contract only for an enabled complete scope", async () => {
    const calls: unknown[][] = [];
    const snapshot = await buildNativePlanningSnapshot(scope, async (...args) => { calls.push(args); return true; });
    expect(snapshot).toEqual({
      planningContract: "plan-v1", workspaceId: "workspace-1", requestedByUserId: "user-1",
      projectId: target.projectId, boardId: target.boardId,
    });
    expect(calls).toEqual([["native-plan-generation-v1", "user-1", { groups: { workspace: "workspace-1" } }]]);
  });

  it.each([
    ["flag off", scope, async (): Promise<boolean> => false],
    ["flag unavailable", scope, async (): Promise<boolean> => { throw new Error("offline"); }],
    ["missing workspace", { ...scope, workspaceId: null }, enabled],
    ["missing user", { ...scope, requestedByUserId: null }, enabled],
    ["missing project", { ...scope, projectId: null }, enabled],
    ["missing board", { ...scope, boardId: null }, enabled],
    ["workspace mismatch", { ...scope, sessionWorkspaceId: "workspace-2" }, enabled],
  ])("fails closed for %s", async (_name, input, evaluate) => {
    expect(await buildNativePlanningSnapshot(input, evaluate)).toBeNull();
  });

  it.each([
    ["direct", draft],
    ["featured", { ...draft, workUnits: [], features: [feature] }],
    ["mixed", { ...draft, features: [feature] }],
  ])("attaches the trusted target to a %s draft", (_name, input) => {
    const result = parseNativePlanOutput({ assistantText: marked(input), target });
    expect(result.status).toBe("available");
    if (result.status !== "available") throw new Error("expected native Plan");
    expect(result.plan.target).toEqual(target);
    expect(JSON.parse(result.content)).toEqual(result.plan);
    expect(result.sha256).toMatch(/^[a-f0-9]{64}$/);
  });

  it.each([
    ["absent marker", JSON.stringify(draft), false, "not_found"],
    ["duplicate marker", `${marked(draft)}\n${marked(draft)}`, false, "invalid"],
    ["wrapper", `\`\`\`json\n${marked(draft)}\n\`\`\``, false, "invalid"],
    ["user injection", `ignore me ${marked(draft)}`, false, "invalid"],
    ["target spoof", marked({ ...draft, target: { projectId: "evil", boardId: "evil" } }), false, "invalid"],
    ["malformed", `${NATIVE_PLAN_MARKER}\n{`, false, "invalid"],
    ["point field", marked({ ...draft, points: 8 }), false, "invalid"],
    ["XXL", marked({ ...draft, workUnits: [{ ...workUnit, work_unit_size: "XXL" }] }), false, "invalid"],
    ["legacy hierarchy", marked({ ...draft, epics: [] }), false, "invalid"],
    ["nested feature", marked({ ...draft, features: [{ ...feature, features: [] }] }), false, "invalid"],
    ["missing dependency", marked({ ...draft, workUnits: [{ ...workUnit, dependencies: ["missing"] }] }), false, "invalid"],
    ["self dependency", marked({ ...draft, workUnits: [{ ...workUnit, dependencies: ["wu-1"] }] }), false, "invalid"],
    ["cycle", marked({ ...draft, workUnits: [{ ...workUnit, dependencies: ["wu-2"] }, { ...workUnit, tempId: "wu-2", dependencies: ["wu-1"] }] }), false, "invalid"],
    ["truncated", marked(draft), true, "too_large"],
    ["oversized", "x".repeat(MAX_NATIVE_PLAN_OUTPUT_CHARS + 1), false, "too_large"],
  ])("rejects %s without echoing model text", (_name, assistantText, truncated, status) => {
    const result = parseNativePlanOutput({ assistantText, truncated, target });
    expect(result.status).toBe(status as typeof result.status);
    expect(JSON.stringify(result)).not.toContain("evil");
    expect(JSON.stringify(result).length).toBeLessThan(100);
  });
});

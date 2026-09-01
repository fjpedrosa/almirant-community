import { describe, expect, it } from "bun:test";
import { DeliveryPlanAcceptanceGateError, assertDeliveryPlanAcceptanceEnabled } from "./delivery-plan-acceptance-gate";

const scope = { workspaceId: "workspace-1", projectId: "10000000-0000-4000-8000-000000000001", boardId: "20000000-0000-4000-8000-000000000002" };

describe("delivery Plan acceptance gate", () => {
  it("requires the workspace flag before running live readiness", async () => {
    let readinessCalls = 0;
    await expect(assertDeliveryPlanAcceptanceEnabled(scope, {
      flagEnabled: async () => false,
      assertReady: async () => { readinessCalls += 1; },
    })).rejects.toEqual(new DeliveryPlanAcceptanceGateError());
    expect(readinessCalls).toBe(0);
  });

  it("fails closed when flag storage or readiness is unavailable", async () => {
    for (const dependencies of [
      { flagEnabled: async () => { throw new Error("raw flag outage"); }, assertReady: async () => {} },
      { flagEnabled: async () => true, assertReady: async () => { throw new Error("raw schema detail"); } },
    ]) {
      await expect(assertDeliveryPlanAcceptanceEnabled(scope, dependencies)).rejects.toEqual(new DeliveryPlanAcceptanceGateError());
    }
  });

  it("admits only a true flag followed by successful live readiness", async () => {
    const calls: string[] = [];
    await assertDeliveryPlanAcceptanceEnabled(scope, {
      flagEnabled: async (_flag, workspaceId) => { calls.push(`flag:${workspaceId}`); return true; },
      assertReady: async (value) => { calls.push(`ready:${value.boardId}`); },
    });
    expect(calls).toEqual([`flag:${scope.workspaceId}`, `ready:${scope.boardId}`]);
  });
});

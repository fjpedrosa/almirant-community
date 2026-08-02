import { describe, expect, it } from "bun:test";
import {
  resolveScheduledAgentExecutionIdentity,
  resolveScheduledDispatchCreatedByUserId,
} from "./scheduled-agent-identity";

describe("resolveScheduledAgentExecutionIdentity", () => {
  it("uses the persisted agent owner as the job and MCP actor", () => {
    expect(
      resolveScheduledAgentExecutionIdentity({
        ownerUserId: "agent-owner",
        requestedByUserId: "manual-triggerer",
      }),
    ).toEqual({
      createdByUserId: "agent-owner",
      requestedByUserId: "manual-triggerer",
    });
  });

  it("preserves legacy manual-trigger behavior when the agent has no owner", () => {
    expect(
      resolveScheduledAgentExecutionIdentity({
        ownerUserId: null,
        requestedByUserId: "manual-triggerer",
      }),
    ).toEqual({
      createdByUserId: "manual-triggerer",
      requestedByUserId: "manual-triggerer",
    });
  });

  it("preserves legacy unattended behavior when neither owner nor requester exists", () => {
    expect(
      resolveScheduledAgentExecutionIdentity({
        ownerUserId: null,
        requestedByUserId: null,
      }),
    ).toEqual({
      createdByUserId: null,
      requestedByUserId: null,
    });
  });
});

describe("resolveScheduledDispatchCreatedByUserId", () => {
  it("returns the resolved user id as-is without querying the workspace owner", async () => {
    const calls: string[] = [];
    const getWorkspaceOwnerUserId = async (workspaceId: string) => {
      calls.push(workspaceId);
      return "should-not-be-used";
    };

    const result = await resolveScheduledDispatchCreatedByUserId(
      "resolved-user-1",
      "workspace-1",
      getWorkspaceOwnerUserId,
    );

    expect(result).toBe("resolved-user-1");
    expect(calls).toEqual([]);
  });

  it("falls back to the workspace owner when the resolved user id is null", async () => {
    const calls: string[] = [];
    const getWorkspaceOwnerUserId = async (workspaceId: string) => {
      calls.push(workspaceId);
      return "workspace-owner-1";
    };

    const result = await resolveScheduledDispatchCreatedByUserId(
      null,
      "workspace-1",
      getWorkspaceOwnerUserId,
    );

    expect(result).toBe("workspace-owner-1");
    expect(calls).toEqual(["workspace-1"]);
  });

  it("falls back to the workspace owner when the resolved user id is undefined or blank", async () => {
    const getWorkspaceOwnerUserId = async () => "workspace-owner-1";

    expect(
      await resolveScheduledDispatchCreatedByUserId(
        undefined,
        "workspace-1",
        getWorkspaceOwnerUserId,
      ),
    ).toBe("workspace-owner-1");
    expect(
      await resolveScheduledDispatchCreatedByUserId(
        "   ",
        "workspace-1",
        getWorkspaceOwnerUserId,
      ),
    ).toBe("workspace-owner-1");
  });

  it("returns undefined when neither the resolved user id nor a workspace owner exist", async () => {
    const result = await resolveScheduledDispatchCreatedByUserId(
      null,
      "workspace-1",
      async () => null,
    );

    expect(result).toBeUndefined();
  });
});

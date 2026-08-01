import { describe, expect, it } from "bun:test";
import {
  ApiKeyWorkspaceError,
  resolveApiKeyWorkspaceId,
} from "./api-key-workspace";

const activeWorkspace = {
  id: "ws-active",
  name: "Active Workspace",
  slug: "active",
};

describe("resolveApiKeyWorkspaceId", () => {
  it("uses the active workspace when no explicit workspace is requested", async () => {
    const workspaceId = await resolveApiKeyWorkspaceId({
      activeWorkspace,
      requestedWorkspaceId: undefined,
      userId: "user-1",
      isWorkspaceMember: async () => {
        throw new Error("membership check should not run for active workspace fallback");
      },
    });

    expect(workspaceId).toBe("ws-active");
  });

  it("accepts the active workspace when explicitly requested", async () => {
    const workspaceId = await resolveApiKeyWorkspaceId({
      activeWorkspace,
      requestedWorkspaceId: " ws-active ",
      userId: "user-1",
      isWorkspaceMember: async () => {
        throw new Error("membership check should not run for already-active workspace");
      },
    });

    expect(workspaceId).toBe("ws-active");
  });

  it("accepts a different workspace only when the user is a member", async () => {
    const checked: Array<{ userId: string; workspaceId: string }> = [];

    const workspaceId = await resolveApiKeyWorkspaceId({
      activeWorkspace,
      requestedWorkspaceId: "ws-shoutrz",
      userId: "user-1",
      isWorkspaceMember: async (userId, workspaceId) => {
        checked.push({ userId, workspaceId });
        return true;
      },
    });

    expect(workspaceId).toBe("ws-shoutrz");
    expect(checked).toEqual([{ userId: "user-1", workspaceId: "ws-shoutrz" }]);
  });

  it("rejects a different workspace when the user is not a member", async () => {
    await expect(
      resolveApiKeyWorkspaceId({
        activeWorkspace,
        requestedWorkspaceId: "ws-other",
        userId: "user-1",
        isWorkspaceMember: async () => false,
      }),
    ).rejects.toMatchObject({
      status: 403,
      message: "Workspace not found or not accessible",
    } satisfies Partial<ApiKeyWorkspaceError>);
  });

  it("rejects requests without an active workspace", async () => {
    await expect(
      resolveApiKeyWorkspaceId({
        activeWorkspace: null,
        requestedWorkspaceId: undefined,
        userId: "user-1",
        isWorkspaceMember: async () => true,
      }),
    ).rejects.toMatchObject({
      status: 403,
      message: "No active workspace",
    } satisfies Partial<ApiKeyWorkspaceError>);
  });
});

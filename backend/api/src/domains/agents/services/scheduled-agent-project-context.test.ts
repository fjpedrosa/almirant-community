import { describe, expect, it } from "bun:test";

import { resolveScheduledAgentProjectContext } from "./scheduled-agent-project-context";

describe("resolveScheduledAgentProjectContext", () => {
  it("keeps the project the agent names", async () => {
    const context = await resolveScheduledAgentProjectContext("ws-1", "project-1");

    expect(context.projectId).toBe("project-1");
  });

  it("resolves to no project when the agent names none", async () => {
    // This used to return the workspace's primary repository — the first by
    // `order`, arbitrary when several tie at 0 — so an agent with no project
    // silently adopted another project's repository and could commit to it.
    const context = await resolveScheduledAgentProjectContext("ws-1", null);

    expect(context).toEqual({ projectId: null, repositoryId: null, repoUrl: null });
  });

  it("treats undefined and empty string as no project", async () => {
    expect(await resolveScheduledAgentProjectContext("ws-1", undefined)).toEqual({
      projectId: null,
      repositoryId: null,
      repoUrl: null,
    });
    expect(await resolveScheduledAgentProjectContext("ws-1", "")).toEqual({
      projectId: null,
      repositoryId: null,
      repoUrl: null,
    });
  });
});

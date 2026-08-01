import { describe, expect, it, mock, beforeEach } from "bun:test";

type CreatedJob = {
  projectId: string | null;
  config: Record<string, unknown>;
};

const created: CreatedJob[] = [];
let projectRepositories: Array<{ id: string; url: string }> = [];

const createJob = mock(async (job: CreatedJob) => {
  created.push(job);
  return { id: "job-1", status: "queued", workItemId: null, planningSessionId: null };
});
const getRepositories = mock(async () => projectRepositories);
const updateScheduledAgentConfigLastRunAt = mock(async () => undefined);

mock.module("@almirant/database", () => ({
  createJob,
  getRepositories,
  updateScheduledAgentConfigLastRunAt,
}));

mock.module("@almirant/config", () => ({
  logger: { info: mock(() => undefined), warn: mock(() => undefined), error: mock(() => undefined) },
}));

mock.module("../../../shared/ws/ws-connection-manager", () => ({
  wsConnectionManager: { broadcastToWorkspace: mock(() => undefined) },
}));

mock.module("./scheduled-agent-effective-model-resolver", () => ({
  resolveScheduledAgentEffectiveRuntimes: mock(async () => [
    { provider: "claude-code", codingAgent: "claude-code", aiProvider: "anthropic", model: "claude-opus-5", reasoningLevel: "high" },
  ]),
}));

mock.module("./scheduled-agent-runtime-validation", () => ({
  assertValidScheduledAgentRuntime: mock(() => undefined),
}));

// scheduled-agent-project-context is deliberately NOT mocked: it is where the
// repository is actually resolved, and stubbing it is what hid the arbitrary
// fallback in the first place.

const { executeScheduledAgentConfig } = await import("./execute-scheduled-agent-config");

const agentConfig = (projectId: string | null) => ({
  id: "agent-1",
  name: "Weekly SEO review",
  workspaceId: "ws-1",
  projectId,
  provider: "claude-code",
  codingAgent: "claude-code",
  aiProvider: "anthropic",
  aiModel: "claude-opus-5",
  reasoningLevel: "high",
  jobType: "scheduled",
  prompt: "do the thing",
  trigger: "scheduled",
  targetConfig: null,
  mcpServers: null,
}) as never;

describe("executeScheduledAgentConfig repository resolution", () => {
  beforeEach(() => {
    created.length = 0;
    projectRepositories = [];
  });

  it("uses the repository of the agent's project", async () => {
    projectRepositories = [{ id: "repo-1", url: "https://github.com/acme/site" }];

    await executeScheduledAgentConfig(agentConfig("project-1"), { createdByUserId: null });

    expect(created[0]?.config.repoUrl).toBe("https://github.com/acme/site");
    expect(created[0]?.config.repositoryId).toBe("repo-1");
    expect(created[0]?.config.repositoryResolution).toBe("project");
  });

  it("starts with an empty workspace when the agent has no project", async () => {
    // The old behaviour reached for the workspace's first repository by `order`.
    // With several tied at 0 that is an arbitrary pick, and an agent written for
    // one project would branch and open a PR against another.
    await executeScheduledAgentConfig(agentConfig(null), { createdByUserId: null });

    expect(created[0]?.config.repoUrl).toBeUndefined();
    expect(created[0]?.config.repositoryId).toBeUndefined();
    expect(created[0]?.config.projectId).toBeUndefined();
  });

  it("records why the job has no repository", async () => {
    await executeScheduledAgentConfig(agentConfig(null), { createdByUserId: null });

    expect(created[0]?.config.repositoryResolution).toBe("none");
  });

  it("does not borrow a repository when the agent's project has none", async () => {
    projectRepositories = [];

    await executeScheduledAgentConfig(agentConfig("project-1"), { createdByUserId: null });

    expect(created[0]?.config.repoUrl).toBeUndefined();
    expect(created[0]?.config.repositoryResolution).toBe("none");
  });
});

import { describe, expect, it } from "bun:test";
import type { ClaimedJob } from "@almirant/remote-agent";
import { getRequestedModel, resolveJobCodingAgent, resolveJobProjectId } from "./job-helpers";

const makeJob = (overrides: Partial<ClaimedJob> = {}): ClaimedJob => ({
  id: "job-1",
  workItemId: null,
  projectId: null,
  boardId: null,
  createdByUserId: null,
  workspaceId: null,
  provider: "codex",
  priority: "medium",
  status: "queued",
  retryCount: 0,
  maxRetries: 2,
  availableAt: null,
  config: null,
  ...overrides,
});

describe("getRequestedModel", () => {
  it("prefers the top-level job.model when present", () => {
    const job = makeJob({
      model: "gpt-5.4",
      config: { model: "o3" },
    });

    expect(getRequestedModel(job)).toBe("gpt-5.4");
  });

  it("falls back to config.model when top-level job.model is missing", () => {
    const job = makeJob({
      config: { model: "gpt-5.4" },
    });

    expect(getRequestedModel(job)).toBe("gpt-5.4");
  });

  it("ignores blank top-level values before checking config.model", () => {
    const job = makeJob({
      model: "   ",
      config: { model: "gpt-5.4" },
    });

    expect(getRequestedModel(job)).toBe("gpt-5.4");
  });
});

describe("resolveJobCodingAgent", () => {
  it("prefers config.codingAgent when present for legacy jobs", () => {
    const job = makeJob({
      codingAgent: "claude-code",
      config: { codingAgent: "opencode" },
    });

    expect(resolveJobCodingAgent(job)).toBe("opencode");
  });

  it("falls back to the top-level job.codingAgent when config is missing", () => {
    const job = makeJob({
      codingAgent: "opencode",
      config: {
        skillName: "runner-implement",
      },
    });

    expect(resolveJobCodingAgent(job)).toBe("opencode");
  });

  it("ignores blank values", () => {
    const job = makeJob({
      codingAgent: "   ",
      config: { codingAgent: "" },
    });

    expect(resolveJobCodingAgent(job)).toBeUndefined();
  });
});

describe("resolveJobProjectId", () => {
  it("prefers the top-level job.projectId when present", () => {
    const job = makeJob({
      projectId: "79d7fd78-037b-41ff-92aa-3671f692062e",
      config: { projectId: "other-project" },
    });

    expect(resolveJobProjectId(job)).toBe("79d7fd78-037b-41ff-92aa-3671f692062e");
  });

  it("falls back to config.projectId when top-level is null", () => {
    const job = makeJob({
      projectId: null,
      config: { projectId: "79d7fd78-037b-41ff-92aa-3671f692062e" },
    });

    expect(resolveJobProjectId(job)).toBe("79d7fd78-037b-41ff-92aa-3671f692062e");
  });

  it("returns undefined when neither source is set", () => {
    const job = makeJob({ projectId: null, config: null });

    expect(resolveJobProjectId(job)).toBeUndefined();
  });

  it("ignores non-string config.projectId values", () => {
    const job = makeJob({
      projectId: null,
      config: { projectId: 42 },
    });

    expect(resolveJobProjectId(job)).toBeUndefined();
  });
});

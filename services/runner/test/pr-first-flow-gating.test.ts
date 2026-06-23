import { describe, expect, it } from "bun:test";
import { shouldPreparePrFirstFlow } from "../src/orchestration/pr-first-flow";

describe("shouldPreparePrFirstFlow", () => {
  it("skips planning jobs even if a repository is present", () => {
    expect(
      shouldPreparePrFirstFlow({
        jobType: "planning",
        interactive: true,
        skillName: "ideate",
        isPrewarm: false,
        repoUrl: "https://github.com/example-org/example-repo",
      }),
    ).toBe(false);
  });

  it("skips prewarm jobs before planning conversion", () => {
    expect(
      shouldPreparePrFirstFlow({
        jobType: "implementation",
        interactive: false,
        skillName: "prewarm",
        isPrewarm: true,
        repoUrl: "https://github.com/example-org/example-repo",
      }),
    ).toBe(false);
  });

  it("skips ideation skills running outside the planning job type", () => {
    expect(
      shouldPreparePrFirstFlow({
        jobType: "implementation",
        interactive: false,
        skillName: "discord-plan",
        isPrewarm: false,
        repoUrl: "https://github.com/example-org/example-repo",
      }),
    ).toBe(false);
  });

  it("skips PR-first flow for read-only analysis jobs", () => {
    expect(
      shouldPreparePrFirstFlow({
        jobType: "incident-analyze",
        interactive: false,
        skillName: "incident-analyze",
        isPrewarm: false,
        repoUrl: "https://github.com/example-org/example-repo",
        config: {
          workspaceIntent: "read-only",
          postSessionPushPolicy: "never",
        },
      }),
    ).toBe(false);
  });

  it("keeps PR-first flow enabled for implementation jobs", () => {
    expect(
      shouldPreparePrFirstFlow({
        jobType: "implementation",
        interactive: false,
        skillName: "implement",
        isPrewarm: false,
        repoUrl: "https://github.com/example-org/example-repo",
      }),
    ).toBe(true);
  });

  it("honors explicit write overrides for PR-first flow", () => {
    expect(
      shouldPreparePrFirstFlow({
        jobType: "planning",
        interactive: true,
        skillName: "ideate",
        isPrewarm: false,
        repoUrl: "https://github.com/example-org/example-repo",
        config: {
          postSessionPushPolicy: "on-success",
        },
      }),
    ).toBe(true);
  });

  it("skips PR-first flow when no repository is available", () => {
    expect(
      shouldPreparePrFirstFlow({
        jobType: "implementation",
        interactive: false,
        skillName: "implement",
        isPrewarm: false,
        repoUrl: undefined,
      }),
    ).toBe(false);
  });

  it("skips PR-first flow for prompt-only scheduled jobs", () => {
    expect(
      shouldPreparePrFirstFlow({
        jobType: "scheduled",
        interactive: false,
        skillName: null,
        promptTemplate: null,
        isPrewarm: false,
        repoUrl: "https://github.com/example-org/example-repo",
      }),
    ).toBe(false);
  });

  it("skips PR-first flow when the skill self-manages its PR (feedback-bug-fix)", () => {
    expect(
      shouldPreparePrFirstFlow({
        jobType: "bug-fix",
        interactive: false,
        skillName: "feedback-bug-fix",
        promptTemplate: "feedback-bug-fix",
        isPrewarm: false,
        repoUrl: "https://github.com/example-org/example-repo",
        config: {
          selfManagesPr: true,
        },
      }),
    ).toBe(false);
  });

  it("keeps PR-first flow enabled when selfManagesPr is absent for a write-capable template", () => {
    expect(
      shouldPreparePrFirstFlow({
        jobType: "implementation",
        interactive: false,
        skillName: "implement",
        promptTemplate: "implement",
        isPrewarm: false,
        repoUrl: "https://github.com/example-org/example-repo",
        config: {},
      }),
    ).toBe(true);
  });

  it("keeps PR-first flow enabled when selfManagesPr is explicitly false", () => {
    expect(
      shouldPreparePrFirstFlow({
        jobType: "implementation",
        interactive: false,
        skillName: "implement",
        promptTemplate: "implement",
        isPrewarm: false,
        repoUrl: "https://github.com/example-org/example-repo",
        config: {
          selfManagesPr: false,
        },
      }),
    ).toBe(true);
  });
});

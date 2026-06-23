import { describe, expect, it } from "bun:test";
import {
  resolvePostSessionPushPolicy,
  shouldSkipPrFirstFlow,
} from "../src/orchestration/job-intent";

describe("resolvePostSessionPushPolicy", () => {
  it("disables push for planning ideation jobs", () => {
    expect(
      resolvePostSessionPushPolicy({
        jobType: "planning",
        skillName: "ideate",
        interactive: true,
        config: {
          workspaceIntent: "read-only",
          postSessionPushPolicy: "never",
        },
      }),
    ).toBe("never");
  });

  it("disables push for prewarm jobs even before planning conversion", () => {
    expect(
      resolvePostSessionPushPolicy({
        jobType: "prewarm",
        skillName: "ideate",
        interactive: false,
        config: {
          isPrewarm: true,
        },
      }),
    ).toBe("never");
  });

  it("disables push for analysis jobs", () => {
    expect(
      resolvePostSessionPushPolicy({
        jobType: "incident-analyze",
        skillName: "incident-analyze",
        interactive: false,
        config: {},
      }),
    ).toBe("never");
  });

  it("keeps push enabled for mutating implementation flows", () => {
    expect(
      resolvePostSessionPushPolicy({
        jobType: "implementation",
        skillName: "runner-implement",
        interactive: false,
        config: {},
      }),
    ).toBe("on-success");
  });

  it("keeps push enabled for DoD remediation runner jobs", () => {
    expect(
      resolvePostSessionPushPolicy({
        jobType: "implementation",
        skillName: "runner-fix-dod",
        promptTemplate: "runner-fix-dod",
        interactive: false,
        config: {},
      }),
    ).toBe("on-success");
  });

  it("honors explicit push policy overrides", () => {
    expect(
      resolvePostSessionPushPolicy({
        jobType: "planning",
        skillName: "ideate",
        interactive: true,
        config: {
          postSessionPushPolicy: "on-success",
        },
      }),
    ).toBe("on-success");
  });

  it("disables push for prompt-only scheduled jobs", () => {
    expect(
      resolvePostSessionPushPolicy({
        jobType: "scheduled",
        skillName: null,
        promptTemplate: null,
        interactive: false,
        config: {},
      }),
    ).toBe("never");
  });

  it("enables push for scheduled jobs with explicit write-capable template", () => {
    expect(
      resolvePostSessionPushPolicy({
        jobType: "scheduled",
        skillName: null,
        promptTemplate: "implement",
        interactive: false,
        config: {},
      }),
    ).toBe("on-success");
  });

  it("keeps push policy on-success for feedback-bug-fix even when self-managing PR", () => {
    // selfManagesPr must NOT alter the post-session push policy; it only
    // gates the pre-draft PR-first flow.
    expect(
      resolvePostSessionPushPolicy({
        jobType: "bug-fix",
        skillName: "feedback-bug-fix",
        promptTemplate: "feedback-bug-fix",
        interactive: false,
        config: {
          selfManagesPr: true,
        },
      }),
    ).toBe("on-success");
  });
});

describe("shouldSkipPrFirstFlow", () => {
  it("returns true when config.selfManagesPr is true", () => {
    expect(
      shouldSkipPrFirstFlow({
        promptTemplate: "feedback-bug-fix",
        skillName: "feedback-bug-fix",
        jobType: "bug-fix",
        interactive: false,
        config: { selfManagesPr: true },
      }),
    ).toBe(true);
  });

  it("returns false when config.selfManagesPr is absent", () => {
    expect(
      shouldSkipPrFirstFlow({
        promptTemplate: "implement",
        skillName: "implement",
        jobType: "implementation",
        interactive: false,
        config: {},
      }),
    ).toBe(false);
  });

  it("returns false when config.selfManagesPr is explicitly false", () => {
    expect(
      shouldSkipPrFirstFlow({
        promptTemplate: "implement",
        skillName: "implement",
        jobType: "implementation",
        interactive: false,
        config: { selfManagesPr: false },
      }),
    ).toBe(false);
  });

  it("returns false when config is null", () => {
    expect(
      shouldSkipPrFirstFlow({
        promptTemplate: "implement",
        skillName: "implement",
        jobType: "implementation",
        interactive: false,
        config: null,
      }),
    ).toBe(false);
  });

  it("returns false for truthy non-true values (strict equality)", () => {
    expect(
      shouldSkipPrFirstFlow({
        promptTemplate: "implement",
        skillName: "implement",
        jobType: "implementation",
        interactive: false,
        config: { selfManagesPr: "true" as unknown as boolean },
      }),
    ).toBe(false);
  });
});

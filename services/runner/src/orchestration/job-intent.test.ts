import { describe, expect, it } from "bun:test";
import {
  getResourcesForTier,
  resolveJobIntent,
  resolveResourceTier,
  resolvePostSessionPushPolicy,
} from "./job-intent";

describe("job intent browser resources", () => {
  it("marks jobs with config.needsBrowser as browser-capable and allocates the heavy tier", () => {
    const intent = resolveJobIntent({
      promptTemplate: "runner-fix-dod",
      interactive: false,
      triggerType: "scheduled",
      config: {
        skillName: "runner-fix-dod",
        needsBrowser: true,
      },
    });

    expect(intent.needsBrowser).toBe(true);
    expect(resolveResourceTier(intent)).toBe("heavy");
    expect(getResourcesForTier("heavy").memoryMb).toBeGreaterThanOrEqual(3072);
  });

  it("keeps non-browser implementation jobs on the standard tier", () => {
    const intent = resolveJobIntent({
      promptTemplate: "runner-fix-dod",
      interactive: false,
      config: {
        skillName: "runner-fix-dod",
      },
    });

    expect(intent.needsBrowser).toBe(false);
    expect(resolveResourceTier(intent)).toBe("standard");
  });

  it("lets browser requirements win over interactive defaults because Chromium needs RAM", () => {
    const intent = resolveJobIntent({
      promptTemplate: "record-video",
      interactive: true,
      config: {
        skillName: "record-video",
        needsBrowser: true,
      },
    });

    expect(resolveResourceTier(intent)).toBe("heavy");
  });
});

describe("job intent release integration defaults", () => {
  it("treats persisted integration templates as write-capable release jobs", () => {
    const intent = resolveJobIntent({
      jobType: "integration",
      skillName: "runner-release-integration",
      promptTemplate: "runner-release-integration",
      triggerType: "scheduled",
      config: {
        batchId: "batch-1",
        integrationPhase: "process",
      },
    });

    expect(intent.promptTemplate).toBe("runner-release-integration");
    expect(intent.triggerType).toBe("scheduled");
    expect(
      resolvePostSessionPushPolicy({
        jobType: "integration",
        skillName: "runner-release-integration",
        promptTemplate: "runner-release-integration",
      }),
    ).toBe("on-success");
  });
});

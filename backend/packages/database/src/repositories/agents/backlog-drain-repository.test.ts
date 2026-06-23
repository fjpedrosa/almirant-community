import { describe, expect, test } from "bun:test";
import {
  countsForBacklogDrainConcurrency,
  type BacklogDrainActiveJobScopeInput,
} from "./backlog-drain-repository";

const activeJob = (
  overrides: Partial<BacklogDrainActiveJobScopeInput> = {},
): BacklogDrainActiveJobScopeInput => ({
  jobType: "implementation",
  skillName: "runner-implement",
  promptTemplate: "runner-implement",
  config: { source: "backlog-drain" },
  ...overrides,
});

describe("countsForBacklogDrainConcurrency", () => {
  test("normal backlog drain ignores active DoD review jobs for project concurrency", () => {
    expect(
      countsForBacklogDrainConcurrency(
        activeJob({
          jobType: "review",
          skillName: "dod-review",
          promptTemplate: "dod-review",
          config: { source: "dod-review" },
        }),
        "implementation",
      ),
    ).toBe(false);
  });

  test("DoD remediation only counts remediation jobs against its own project slots", () => {
    expect(
      countsForBacklogDrainConcurrency(
        activeJob({
          skillName: "runner-implement",
          promptTemplate: "runner-implement",
          config: { source: "backlog-drain" },
        }),
        "dod-remediation",
      ),
    ).toBe(false);

    expect(
      countsForBacklogDrainConcurrency(
        activeJob({
          skillName: "runner-fix-dod",
          promptTemplate: "runner-fix-dod",
          config: { source: "dod-remediation" },
        }),
        "dod-remediation",
      ),
    ).toBe(true);
  });
});

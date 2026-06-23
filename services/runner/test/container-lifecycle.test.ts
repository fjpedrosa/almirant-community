import { describe, expect, it } from "bun:test";
import { determineArchiveStrategy } from "../src/workspace/container-lifecycle";

describe("determineArchiveStrategy", () => {
  const validInput = {
    containerId: "abc123",
    containerRunning: true,
    sessionSuccess: true,
    repoUrl: "https://github.com/org/repo.git",
  };

  it('returns "extract" when all conditions are met', () => {
    expect(determineArchiveStrategy(validInput)).toBe("extract");
  });

  it('returns "skip" when container is not running', () => {
    expect(
      determineArchiveStrategy({ ...validInput, containerRunning: false })
    ).toBe("skip");
  });

  it('returns "skip" when session failed', () => {
    expect(
      determineArchiveStrategy({ ...validInput, sessionSuccess: false })
    ).toBe("skip");
  });

  it('returns "skip" when no containerId', () => {
    expect(
      determineArchiveStrategy({ ...validInput, containerId: undefined })
    ).toBe("skip");
  });

  it('returns "skip" when no repoUrl', () => {
    expect(
      determineArchiveStrategy({ ...validInput, repoUrl: undefined })
    ).toBe("skip");
  });
});

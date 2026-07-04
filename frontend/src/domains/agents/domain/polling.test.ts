import { describe, test, expect } from "bun:test";
import type { AgentJobStatus } from "./types";
import {
  isActiveJobStatus,
  isTerminalJobStatus,
  activeJobPollInterval,
  jobCollectionPollInterval,
} from "./polling";

const ACTIVE: AgentJobStatus[] = [
  "queued",
  "running",
  "finalizing",
  "waiting_for_input",
  "paused",
];

const TERMINAL: AgentJobStatus[] = [
  "completed",
  "incomplete",
  "failed",
  "cancelled",
];

describe("isActiveJobStatus", () => {
  for (const status of ACTIVE) {
    test(`"${status}" is active`, () => {
      expect(isActiveJobStatus(status)).toBe(true);
    });
  }

  for (const status of TERMINAL) {
    test(`"${status}" is NOT active`, () => {
      expect(isActiveJobStatus(status)).toBe(false);
    });
  }

  test("null / undefined are not active", () => {
    expect(isActiveJobStatus(null)).toBe(false);
    expect(isActiveJobStatus(undefined)).toBe(false);
  });
});

describe("isTerminalJobStatus", () => {
  for (const status of TERMINAL) {
    test(`"${status}" is terminal`, () => {
      expect(isTerminalJobStatus(status)).toBe(true);
    });
  }

  for (const status of ACTIVE) {
    test(`"${status}" is NOT terminal`, () => {
      expect(isTerminalJobStatus(status)).toBe(false);
    });
  }

  test("null / undefined are not terminal (state unknown)", () => {
    expect(isTerminalJobStatus(null)).toBe(false);
    expect(isTerminalJobStatus(undefined)).toBe(false);
  });
});

describe("activeJobPollInterval", () => {
  test("active job keeps polling at the given interval (freshness preserved)", () => {
    expect(activeJobPollInterval(true, 5_000)).toBe(5_000);
    expect(activeJobPollInterval(true, 4_000)).toBe(4_000);
  });

  test("terminal / inactive job STOPS polling (false)", () => {
    expect(activeJobPollInterval(false, 5_000)).toBe(false);
    expect(activeJobPollInterval(false, 30_000)).toBe(false);
  });
});

describe("jobCollectionPollInterval", () => {
  test("any active member → fast active interval (live freshness)", () => {
    expect(
      jobCollectionPollInterval(["completed", "running"], 8_000, false),
    ).toBe(8_000);
    expect(
      jobCollectionPollInterval(["queued"], 5_000, 60_000),
    ).toBe(5_000);
  });

  test("no active member → idle fallback (here: stop, WS keeps it fresh)", () => {
    expect(
      jobCollectionPollInterval(["completed", "failed"], 8_000, false),
    ).toBe(false);
  });

  test("no active member → configurable relaxed idle interval", () => {
    expect(
      jobCollectionPollInterval(["completed"], 8_000, 60_000),
    ).toBe(60_000);
  });

  test("empty collection → idle fallback", () => {
    expect(jobCollectionPollInterval([], 8_000, false)).toBe(false);
  });

  test("tolerates null / undefined statuses in the collection", () => {
    expect(
      jobCollectionPollInterval([null, undefined, "running"], 8_000, false),
    ).toBe(8_000);
    expect(
      jobCollectionPollInterval([null, undefined], 8_000, false),
    ).toBe(false);
  });
});

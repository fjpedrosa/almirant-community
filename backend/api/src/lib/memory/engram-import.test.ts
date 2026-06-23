import { describe, expect, test } from "bun:test";
import {
  buildImportTopicKey,
  classifyEngramObservationType,
  resolveVisibilityFromScope,
} from "./engram-import";

describe("classifyEngramObservationType", () => {
  test("keeps reusable technical memories active by default", () => {
    expect(classifyEngramObservationType("bugfix")).toEqual({
      targetType: "bugfix",
      disposition: "active",
      confidence: 0.75,
    });

    expect(classifyEngramObservationType("architecture")).toEqual({
      targetType: "architecture",
      disposition: "active",
      confidence: 0.75,
    });
  });

  test("archives session summaries by default instead of mixing them into active retrieval", () => {
    expect(classifyEngramObservationType("session_summary")).toEqual({
      targetType: "discovery",
      disposition: "archived",
      confidence: 0.45,
    });
  });

  test("allows policy overrides for historical Engram types", () => {
    expect(
      classifyEngramObservationType("preference", { preference: "skip" })
    ).toEqual({
      targetType: "decision",
      disposition: "skip",
      confidence: 0.5,
    });
  });
});

describe("resolveVisibilityFromScope", () => {
  test("maps project scope to project visibility", () => {
    expect(resolveVisibilityFromScope("project")).toEqual({
      visibility: "project",
      ownerUserId: null,
    });
  });

  test("requires ownerUserId for personal scope", () => {
    expect(resolveVisibilityFromScope("personal")).toBeNull();
    expect(resolveVisibilityFromScope("personal", "user-1")).toEqual({
      visibility: "personal",
      ownerUserId: "user-1",
    });
  });
});

describe("buildImportTopicKey", () => {
  test("reuses valid Engram topic keys when possible", () => {
    expect(
      buildImportTopicKey("bugfix", {
        id: 12,
        type: "bugfix",
        title: "Fixed runner crash",
        topicKey: "bugfix/runner-crash",
      })
    ).toBe("bugfix/runner-crash");
  });

  test("falls back to a generated, valid topic key when source key is missing or invalid", () => {
    expect(
      buildImportTopicKey("discovery", {
        id: 99,
        type: "session_summary",
        title: "Session summary: almirant",
        topicKey: "INVALID TOPIC KEY",
      })
    ).toBe("discovery/engram/session-summary-99-session-summary-almirant");
  });
});

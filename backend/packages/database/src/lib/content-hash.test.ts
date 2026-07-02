import { describe, test, expect } from "bun:test";
import {
  computeContentHash,
  computeWorkItemContentHash,
} from "./content-hash";

describe("computeContentHash", () => {
  test("is deterministic: same input produces same hash", () => {
    const input = "hello world";
    const hashA = computeContentHash(input);
    const hashB = computeContentHash(input);
    expect(hashA).toBe(hashB);
    // SHA256 hex is 64 chars
    expect(hashA).toHaveLength(64);
  });

  test("normalizes CRLF line endings to LF before hashing", () => {
    const withCrlf = "line1\r\nline2\r\nline3";
    const withLf = "line1\nline2\nline3";
    expect(computeContentHash(withCrlf)).toBe(computeContentHash(withLf));
  });

  test("trims surrounding whitespace before hashing", () => {
    const trimmed = "content";
    const padded = "   \n  content  \n  ";
    expect(computeContentHash(padded)).toBe(computeContentHash(trimmed));
  });

  test("different content produces different hash", () => {
    expect(computeContentHash("a")).not.toBe(computeContentHash("b"));
  });
});

describe("computeWorkItemContentHash", () => {
  const baseWorkItem = {
    title: "Implement feature X",
    description: "A description of the feature",
    type: "task",
    parentId: "parent-123",
    childIds: ["child-1", "child-2"],
  };

  test("is deterministic: same input produces same hash", () => {
    const hashA = computeWorkItemContentHash(baseWorkItem);
    const hashB = computeWorkItemContentHash(baseWorkItem);
    expect(hashA).toBe(hashB);
    expect(hashA).toHaveLength(64);
  });

  test("childIds order does NOT affect the hash", () => {
    const hashAscending = computeWorkItemContentHash({
      ...baseWorkItem,
      childIds: ["a", "b", "c"],
    });
    const hashDescending = computeWorkItemContentHash({
      ...baseWorkItem,
      childIds: ["c", "b", "a"],
    });
    const hashShuffled = computeWorkItemContentHash({
      ...baseWorkItem,
      childIds: ["b", "a", "c"],
    });
    expect(hashAscending).toBe(hashDescending);
    expect(hashAscending).toBe(hashShuffled);
  });

  test("changing title changes the hash", () => {
    const original = computeWorkItemContentHash(baseWorkItem);
    const changed = computeWorkItemContentHash({
      ...baseWorkItem,
      title: "A different title",
    });
    expect(original).not.toBe(changed);
  });

  test("changing description changes the hash", () => {
    const original = computeWorkItemContentHash(baseWorkItem);
    const changed = computeWorkItemContentHash({
      ...baseWorkItem,
      description: "Totally new description",
    });
    expect(original).not.toBe(changed);
  });

  test("changing type changes the hash", () => {
    const original = computeWorkItemContentHash(baseWorkItem);
    const changed = computeWorkItemContentHash({
      ...baseWorkItem,
      type: "story",
    });
    expect(original).not.toBe(changed);
  });

  test("changing parentId changes the hash", () => {
    const original = computeWorkItemContentHash(baseWorkItem);
    const changed = computeWorkItemContentHash({
      ...baseWorkItem,
      parentId: "different-parent",
    });
    expect(original).not.toBe(changed);
  });

  test("line ending normalization: CRLF vs LF in description produces equal hash", () => {
    const withCrlf = computeWorkItemContentHash({
      ...baseWorkItem,
      description: "line1\r\nline2\r\nline3",
    });
    const withLf = computeWorkItemContentHash({
      ...baseWorkItem,
      description: "line1\nline2\nline3",
    });
    expect(withCrlf).toBe(withLf);
  });

  test("treats undefined/null description and parentId as empty strings", () => {
    const hashWithNulls = computeWorkItemContentHash({
      title: "t",
      description: null,
      type: "task",
      parentId: null,
      childIds: [],
    });
    const hashWithUndefined = computeWorkItemContentHash({
      title: "t",
      type: "task",
    });
    expect(hashWithNulls).toBe(hashWithUndefined);
  });

  test("omitting childIds is equivalent to empty array", () => {
    const withEmpty = computeWorkItemContentHash({
      title: "t",
      type: "task",
      childIds: [],
    });
    const withoutField = computeWorkItemContentHash({
      title: "t",
      type: "task",
    });
    expect(withEmpty).toBe(withoutField);
  });
});

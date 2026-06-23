import { describe, expect, test } from "bun:test";
import { topologicallySortCandidatesPure } from "./integration-batch-repository";

interface TestCandidate {
  id: string;
  taskId: string;
}

const c = (id: string): TestCandidate => ({ id, taskId: id });

describe("topologicallySortCandidatesPure", () => {
  test("returns the input unchanged when no deps are provided", () => {
    const candidates = [c("S-F-5"), c("S-F-6"), c("S-F-8")];
    const sorted = topologicallySortCandidatesPure(candidates, []);
    expect(sorted.map((x) => x.id)).toEqual(["S-F-5", "S-F-6", "S-F-8"]);
  });

  test("returns the input unchanged for a single candidate", () => {
    const sorted = topologicallySortCandidatesPure([c("only")], []);
    expect(sorted.map((x) => x.id)).toEqual(["only"]);
  });

  test("moves a dependent feature behind its dependency", () => {
    // S-F-8 is blocked by S-F-6 (it merges S-F-6's branch). Even though
    // S-F-8 came first in PR-creation order, the sort must put it last.
    const candidates = [c("S-F-8"), c("S-F-5"), c("S-F-6")];
    const sorted = topologicallySortCandidatesPure(candidates, [
      { workItemId: "S-F-8", blockedByWorkItemId: "S-F-6" },
    ]);
    expect(sorted.map((x) => x.id)).toEqual(["S-F-5", "S-F-6", "S-F-8"]);
  });

  test("preserves input order between candidates with no relative dep", () => {
    // S-F-5 has no relation to S-F-6 or S-F-8. Even though there's a
    // dependency between S-F-6 and S-F-8, S-F-5 should stay in its
    // original position relative to non-related candidates.
    const candidates = [c("S-F-5"), c("S-F-8"), c("S-F-6")];
    const sorted = topologicallySortCandidatesPure(candidates, [
      { workItemId: "S-F-8", blockedByWorkItemId: "S-F-6" },
    ]);
    // S-F-5 keeps position 0; S-F-6 moves before S-F-8.
    expect(sorted.map((x) => x.id)).toEqual(["S-F-5", "S-F-6", "S-F-8"]);
  });

  test("ignores dep edges that point outside the candidate set", () => {
    // The candidate set does not contain "external-thing"; that edge must
    // not block anyone.
    const candidates = [c("S-F-5"), c("S-F-6")];
    const sorted = topologicallySortCandidatesPure(candidates, [
      { workItemId: "S-F-5", blockedByWorkItemId: "external-thing" },
    ]);
    expect(sorted.map((x) => x.id)).toEqual(["S-F-5", "S-F-6"]);
  });

  test("handles a chain of three deps in reverse order", () => {
    // C ← B ← A : A must come first, then B, then C.
    const candidates = [c("C"), c("B"), c("A")];
    const sorted = topologicallySortCandidatesPure(candidates, [
      { workItemId: "B", blockedByWorkItemId: "A" },
      { workItemId: "C", blockedByWorkItemId: "B" },
    ]);
    expect(sorted.map((x) => x.id)).toEqual(["A", "B", "C"]);
  });

  test("falls back to original order on cycle (data bug)", () => {
    // A ← B ← A is a cycle. Don't crash, don't drop items — just give up
    // and return the input unchanged so the caller still processes them.
    const candidates = [c("A"), c("B")];
    const sorted = topologicallySortCandidatesPure(candidates, [
      { workItemId: "A", blockedByWorkItemId: "B" },
      { workItemId: "B", blockedByWorkItemId: "A" },
    ]);
    expect(sorted.map((x) => x.id)).toEqual(["A", "B"]);
  });

  test("ignores self-loops as a defensive measure", () => {
    const candidates = [c("A"), c("B")];
    const sorted = topologicallySortCandidatesPure(candidates, [
      { workItemId: "A", blockedByWorkItemId: "A" },
    ]);
    expect(sorted.map((x) => x.id)).toEqual(["A", "B"]);
  });

  test("respects original position as the tiebreaker for unrelated nodes", () => {
    // X has no deps. A ← B. Y has no deps. Original order: X, B, A, Y.
    // After topo: X, A, B, Y — X stays first, A moves before B (its
    // dependent), Y stays last.
    const candidates = [c("X"), c("B"), c("A"), c("Y")];
    const sorted = topologicallySortCandidatesPure(candidates, [
      { workItemId: "B", blockedByWorkItemId: "A" },
    ]);
    expect(sorted.map((x) => x.id)).toEqual(["X", "A", "B", "Y"]);
  });
});

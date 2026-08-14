import { describe, expect, it } from "bun:test";

import {
  planEstimationEnqueuesForCreate,
  planEstimationEnqueuesForUpdate,
} from "../../domains/project-management/work-items/services/work-item-estimation-enqueue";

const before = {
  title: "Original title",
  description: "Original description",
  type: "task",
  parentId: null as string | null,
};

describe("planEstimationEnqueuesForCreate", () => {
  it("estimates every created work item", () => {
    expect(planEstimationEnqueuesForCreate({ id: "wi-1", parentId: null })).toEqual([
      ["wi-1", "created"],
    ]);
  });

  it("also bumps the parent, whose estimate depends on its children", () => {
    expect(
      planEstimationEnqueuesForCreate({ id: "wi-1", parentId: "wi-parent" }),
    ).toEqual([
      ["wi-1", "created"],
      ["wi-parent", "child-added"],
    ]);
  });
});

describe("planEstimationEnqueuesForUpdate", () => {
  it("re-estimates when the title changes", () => {
    expect(
      planEstimationEnqueuesForUpdate("wi-1", before, { title: "New title" }),
    ).toEqual([["wi-1", "updated"]]);
  });

  it("re-estimates when the description or type changes", () => {
    expect(
      planEstimationEnqueuesForUpdate("wi-1", before, { description: "Rewritten" }),
    ).toEqual([["wi-1", "updated"]]);
    expect(
      planEstimationEnqueuesForUpdate("wi-1", before, { type: "feature" }),
    ).toEqual([["wi-1", "updated"]]);
  });

  it("does nothing when a content field is set to its current value", () => {
    // MCP clients routinely resend unchanged fields; re-estimating those would
    // burn provider quota on an identical content hash.
    expect(
      planEstimationEnqueuesForUpdate("wi-1", before, {
        title: before.title,
        description: before.description ?? undefined,
        type: before.type,
      }),
    ).toEqual([]);
  });

  it("does nothing for a write that touches no content field", () => {
    expect(planEstimationEnqueuesForUpdate("wi-1", before, {})).toEqual([]);
  });

  it("bumps the new parent when one is attached", () => {
    expect(
      planEstimationEnqueuesForUpdate("wi-1", before, { parentId: "wi-new-parent" }),
    ).toEqual([
      ["wi-1", "updated"],
      ["wi-new-parent", "child-added"],
    ]);
  });

  it("bumps both parents when the item is reparented", () => {
    expect(
      planEstimationEnqueuesForUpdate(
        "wi-1",
        { ...before, parentId: "wi-old-parent" },
        { parentId: "wi-new-parent" },
      ),
    ).toEqual([
      ["wi-1", "updated"],
      ["wi-old-parent", "child-removed"],
      ["wi-new-parent", "child-added"],
    ]);
  });

  it("bumps the old parent when the parent is cleared", () => {
    expect(
      planEstimationEnqueuesForUpdate(
        "wi-1",
        { ...before, parentId: "wi-old-parent" },
        { parentId: null },
      ),
    ).toEqual([
      ["wi-1", "updated"],
      ["wi-old-parent", "child-removed"],
    ]);
  });
});

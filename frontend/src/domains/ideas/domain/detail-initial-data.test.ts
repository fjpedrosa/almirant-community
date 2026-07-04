import { describe, expect, it } from "bun:test";
import {
  ideaDetailInitialData,
  ideaTraceabilityInitialData,
} from "./detail-initial-data";
import type { IdeaItemWithRelations } from "./types";

const fullItem = (): IdeaItemWithRelations =>
  ({
    id: "idea-1",
    title: "Test idea",
    feedbackLinks: [{ id: "f1" }],
    workItemLinks: [{ id: "w1" }],
  } as unknown as IdeaItemWithRelations);

describe("ideaDetailInitialData (seed detail query from the list object)", () => {
  it("returns the item when it carries traceability fields (list has full object)", () => {
    const item = fullItem();
    expect(ideaDetailInitialData(item)).toBe(item);
  });

  it("returns undefined when there is no list item", () => {
    expect(ideaDetailInitialData(null)).toBeUndefined();
  });

  it("returns undefined when the list item is slimmed (Phase 5: no traceability fields)", () => {
    const slim = { id: "idea-1", title: "x" } as unknown as IdeaItemWithRelations;
    expect(ideaDetailInitialData(slim)).toBeUndefined();
  });
});

describe("ideaTraceabilityInitialData (skip the /:id/traceability GET on open)", () => {
  it("builds the traceability result from the list item's links", () => {
    const item = fullItem();
    const result = ideaTraceabilityInitialData(item);
    expect(result).toEqual({
      ideaItem: item,
      feedbackLinks: item.feedbackLinks,
      workItemLinks: item.workItemLinks,
    });
  });

  it("returns undefined when the list item lacks link fields", () => {
    const slim = { id: "idea-1" } as unknown as IdeaItemWithRelations;
    expect(ideaTraceabilityInitialData(slim)).toBeUndefined();
    expect(ideaTraceabilityInitialData(null)).toBeUndefined();
  });
});

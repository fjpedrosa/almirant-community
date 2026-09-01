import { describe, expect, it } from "bun:test";
import {
  getBoardFilterParamsFromSearchParams,
  hasExplicitBoardFilterParams,
  mergePersistedBoardFilterParams,
} from "./board-filter-params";

describe("getBoardFilterParamsFromSearchParams", () => {
  it("reads URL filters even when dynamic filter options are not loaded", () => {
    const params = getBoardFilterParamsFromSearchParams(
      {
        projectId: "project-1",
        tagIds: "tag-1,tag-2",
        isBug: "true",
        type: "task",
        search: "checkout",
      },
      { includeSearch: true },
    );

    expect(params).toEqual({
      projectId: "project-1",
      tagIds: "tag-1,tag-2",
      isBug: "true",
      type: "task",
      search: "checkout",
    });
  });

  it("recognizes an empty explicit filter as authoritative", () => {
    expect(hasExplicitBoardFilterParams({ projectId: "" })).toBe(true);
    expect(hasExplicitBoardFilterParams({})).toBe(false);
  });
});

describe("mergePersistedBoardFilterParams", () => {
  it("makes persisted filters available to the first board request", () => {
    expect(
      mergePersistedBoardFilterParams(
        { search: "checkout" },
        { priority: "high", isBug: "true" },
        false,
      ),
    ).toEqual({ search: "checkout", priority: "high", isBug: "true" });
  });

  it("keeps explicit URL filters authoritative over persisted preferences", () => {
    expect(
      mergePersistedBoardFilterParams(
        { priority: "low" },
        { priority: "high", isBug: "true" },
        true,
      ),
    ).toEqual({ priority: "low" });
  });
});

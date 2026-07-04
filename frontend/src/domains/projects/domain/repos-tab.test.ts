import { describe, expect, it } from "bun:test";
import { shouldFetchRepos } from "./repos-tab";

describe("shouldFetchRepos (project detail eager github repos gating)", () => {
  it("is true only when the Repos tab is active", () => {
    expect(shouldFetchRepos("repos")).toBe(true);
  });

  it("is false for any other tab (no eager installation-wide pagination)", () => {
    expect(shouldFetchRepos("overview")).toBe(false);
    expect(shouldFetchRepos("sprints")).toBe(false);
    expect(shouldFetchRepos("notes")).toBe(false);
    expect(shouldFetchRepos("settings")).toBe(false);
    expect(shouldFetchRepos("")).toBe(false);
  });
});

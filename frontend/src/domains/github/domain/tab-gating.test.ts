import { describe, expect, it } from "bun:test";
import { githubHooksEnabled } from "./tab-gating";
import type { GithubConnectionStatus } from "./types";

const status = (over: Partial<GithubConnectionStatus>): GithubConnectionStatus => ({
  configured: true,
  installations: [{ installationId: 1 } as GithubConnectionStatus["installations"][number]],
  linkedRepos: [{ repoId: "r1", githubRepoFullName: "a/b" }],
  ...over,
});

describe("githubHooksEnabled (github tab 6 wasted calls gating)", () => {
  it("is true when configured with an installation AND at least one linked repo AND a projectId", () => {
    expect(githubHooksEnabled("p1", status({}))).toBe(true);
  });

  it("is false while status is still loading (undefined)", () => {
    expect(githubHooksEnabled("p1", undefined)).toBe(false);
  });

  it("is false when there is no projectId", () => {
    expect(githubHooksEnabled("", status({}))).toBe(false);
  });

  it("is false when not configured (not connected)", () => {
    expect(githubHooksEnabled("p1", status({ configured: false }))).toBe(false);
  });

  it("is false when there are no installations", () => {
    expect(githubHooksEnabled("p1", status({ installations: [] }))).toBe(false);
  });

  it("is false when there are no linked repos (nothing to fetch upstream)", () => {
    expect(githubHooksEnabled("p1", status({ linkedRepos: [] }))).toBe(false);
  });
});

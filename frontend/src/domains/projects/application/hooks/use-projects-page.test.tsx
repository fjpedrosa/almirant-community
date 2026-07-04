import React from "react";
import { afterAll, afterEach, beforeAll, describe, expect, it, mock } from "bun:test";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

/**
 * Performance change (Phase 5 — batch GitHub summaries): the projects page must
 * fetch GitHub summaries for ALL projects in a SINGLE batch request
 * (githubApi.getSummaries), not one getSummary request per project (N+1). It
 * must still map each summary back onto its project by id, keeping the same
 * `.github` shape the presentational components consume.
 */

// Prevent the real Better-Auth client (created at module load in
// `@/lib/auth-client`) from running against a null base URL under happy-dom.
mock.module("@/lib/auth-client", () => ({
  authClient: {
    useActiveOrganization: () => ({ data: { id: "team-1" }, isPending: false }),
    organization: { setActive: async () => ({ error: null }) },
  },
}));

const getSummariesSpy = mock(
  async (_projectIds: string[]): Promise<Record<string, unknown>> => ({
    p1: {
      openPrCount: 3,
      lastCommitAt: "2026-01-02T00:00:00.000Z",
      lastDeployStatus: null,
    },
    p2: {
      openPrCount: 7,
      lastCommitAt: null,
      lastDeployStatus: null,
    },
  }),
);
const getSummarySpy = mock(async (_projectId: string) => ({}));

const testProjects = [
  {
    id: "p1",
    name: "Project 1",
    status: "active",
    repositories: [
      { provider: "github", url: "https://github.com/acme/p1" },
    ],
  },
  {
    id: "p2",
    name: "Project 2",
    status: "active",
    repositories: [
      { provider: "github", url: "https://github.com/acme/p2" },
    ],
  },
  {
    id: "p3",
    name: "Project 3 (no github)",
    status: "active",
    repositories: [
      { provider: "gitlab", url: "https://gitlab.com/acme/p3" },
    ],
  },
];

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let realApi: any;

beforeAll(async () => {
  realApi = await import("@/lib/api/client");
  mock.module("@/lib/api/client", () => ({
    ...realApi,
    githubApi: {
      ...realApi.githubApi,
      getSummary: getSummarySpy,
      getSummaries: getSummariesSpy,
    },
  }));

  // Isolate the hook from the real projects query stack (useActiveTeam, org
  // scoping, projectsApi). We only care about the GitHub summary fan-in here.
  mock.module("./use-projects", () => ({
    useProjectsWithPagination: () => ({
      data: { projects: testProjects, meta: { total: testProjects.length } },
      isLoading: false,
    }),
  }));
});

afterAll(() => {
  mock.module("@/lib/api/client", () => realApi);
  mock.restore();
});

afterEach(() => {
  getSummariesSpy.mockClear();
  getSummarySpy.mockClear();
});

const wrapper = ({ children }: { children: React.ReactNode }) => (
  <QueryClientProvider
    client={
      new QueryClient({
        defaultOptions: { queries: { retry: false } },
      })
    }
  >
    {children}
  </QueryClientProvider>
);

describe("useProjectsPage — batch GitHub summaries", () => {
  it("issues ONE batch request for all github projects and never the per-project endpoint", async () => {
    const { useProjectsPage } = await import("./use-projects-page");

    renderHook(() => useProjectsPage(), { wrapper });

    await waitFor(() => {
      expect(getSummariesSpy).toHaveBeenCalledTimes(1);
    });

    // Single batch call carrying exactly the github project ids...
    const requestedIds = getSummariesSpy.mock.calls[0]![0];
    expect([...requestedIds].sort()).toEqual(["p1", "p2"]);

    // ...and NEVER the N+1 per-project endpoint.
    expect(getSummarySpy).not.toHaveBeenCalled();
  });

  it("maps each summary back onto its project by id, preserving the .github shape", async () => {
    const { useProjectsPage } = await import("./use-projects-page");

    const { result } = renderHook(() => useProjectsPage(), { wrapper });

    await waitFor(() => {
      const p1 = result.current.projects.find((p) => p.id === "p1") as
        | { github?: { openPrCount: number } }
        | undefined;
      expect(p1?.github?.openPrCount).toBe(3);
    });

    const projects = result.current.projects as Array<{
      id: string;
      github?: {
        githubRepoUrl: string | null;
        openPrCount: number;
        lastCommitAt: string | null;
      };
    }>;

    const p1 = projects.find((p) => p.id === "p1");
    const p2 = projects.find((p) => p.id === "p2");
    const p3 = projects.find((p) => p.id === "p3");

    expect(p1?.github?.openPrCount).toBe(3);
    expect(p1?.github?.githubRepoUrl).toBe("https://github.com/acme/p1");
    expect(p2?.github?.openPrCount).toBe(7);
    expect(p2?.github?.githubRepoUrl).toBe("https://github.com/acme/p2");
    // Non-github project keeps no github field.
    expect(p3?.github).toBeUndefined();
  });
});

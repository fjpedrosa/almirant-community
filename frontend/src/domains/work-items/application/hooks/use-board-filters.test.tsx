import { beforeEach, describe, expect, it, mock } from "bun:test";
import { renderHook, waitFor } from "@testing-library/react";

let currentSearch = "";
const replacedUrls: string[] = [];

const savedPreferences = {
  groupBy: "none",
  projectId: "saved-project",
};

mock.module("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(currentSearch),
  usePathname: () => "/board",
  useRouter: () => ({
    push: (url: string) => {
      currentSearch = url.split("?")[1] ?? "";
    },
    replace: (url: string) => {
      replacedUrls.push(url);
      currentSearch = url.split("?")[1] ?? "";
    },
  }),
}));

mock.module("next-intl", () => ({
  useTranslations: () => (key: string) => key,
}));

mock.module("@/domains/tags/application/hooks/use-tags", () => ({
  useTags: () => ({ data: [] }),
}));

mock.module("@/domains/projects/application/hooks/use-projects", () => ({
  useProjects: () => ({
    data: [
      { id: "saved-project", name: "Saved project" },
      { id: "url-project", name: "URL project" },
    ],
  }),
}));

mock.module("@/domains/shared/application/hooks/use-view-preferences", () => ({
  useViewPreferences: () => ({
    preferences: savedPreferences,
    isLoaded: true,
    updatePreference: mock(() => {}),
  }),
}));

describe("useBoardFilters", () => {
  beforeEach(() => {
    currentSearch = "";
    replacedUrls.length = 0;
  });

  it("keeps saved dynamic filters when the URL only specifies groupBy", async () => {
    currentSearch = "groupBy=topmost";
    const { useBoardFilters } = await import("./use-board-filters");
    const { result, rerender } = renderHook(() =>
      useBoardFilters([], { area: "desarrollo" }),
    );

    await waitFor(() =>
      expect(replacedUrls).toEqual([
        "/board?groupBy=topmost&projectId=saved-project",
      ]),
    );

    rerender();
    await waitFor(() => expect(result.current.isPrefsLoaded).toBe(true));

    expect(result.current.groupBy).toBe("topmost");
    expect(result.current.filterParams).toEqual({
      projectId: "saved-project",
    });
  });

  it("keeps an explicit URL dynamic filter ahead of saved preferences", async () => {
    currentSearch = "groupBy=topmost&projectId=url-project";
    const { useBoardFilters } = await import("./use-board-filters");
    const { result } = renderHook(() =>
      useBoardFilters([], { area: "desarrollo" }),
    );

    await waitFor(() => expect(result.current.isPrefsLoaded).toBe(true));

    expect(replacedUrls).toEqual([]);
    expect(result.current.groupBy).toBe("topmost");
    expect(result.current.filterParams).toEqual({
      projectId: "url-project",
    });
  });
});

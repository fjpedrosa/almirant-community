import { describe, expect, it, mock, beforeEach } from "bun:test";
import { act, renderHook } from "@testing-library/react";
import type { DynamicFiltersConfig } from "../../domain/filter-types";

let currentSearch = "";
let pushedUrls: string[] = [];

mock.module("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(currentSearch),
  useRouter: () => ({
    push: (url: string) => {
      pushedUrls.push(url);
      currentSearch = url.split("?")[1] ?? "";
    },
  }),
  usePathname: () => "/sessions",
}));

const config: DynamicFiltersConfig = {
  resetPageOnChange: true,
  definitions: [
    {
      id: "status",
      label: "Status",
      type: "select",
      operators: ["equals"],
      options: [
        { value: "running", label: "Running" },
        { value: "paused", label: "Paused" },
      ],
    },
    {
      id: "taskId",
      label: "Task ID",
      type: "text",
      operators: ["contains"],
    },
  ],
};

const configWithoutPageReset: DynamicFiltersConfig = {
  ...config,
  resetPageOnChange: false,
};

const multiSelectConfig: DynamicFiltersConfig = {
  resetPageOnChange: true,
  definitions: [
    {
      id: "status",
      label: "Status",
      type: "multi_select",
      operators: ["in"],
      defaultOperator: "in",
      options: [
        { value: "queued", label: "Queued" },
        { value: "running", label: "Running" },
        { value: "paused", label: "Paused" },
      ],
    },
    {
      id: "projectId",
      label: "Project",
      type: "multi_select",
      operators: ["in"],
      defaultOperator: "in",
      options: [
        { value: "project-1", label: "Project 1", color: "#22c55e" },
        { value: "project-2", label: "Project 2", color: "#38bdf8" },
      ],
    },
  ],
};

describe("useUrlDynamicFilters", () => {
  beforeEach(() => {
    currentSearch = "";
    pushedUrls = [];
  });

  it("resetea la paginación al aplicar un filtro cuando la config lo pide", async () => {
    currentSearch = "page=7&limit=20";
    const { useUrlDynamicFilters } = await import("./use-url-dynamic-filters");
    const { result } = renderHook(() => useUrlDynamicFilters(config));

    act(() => {
      result.current.addFilter(config.definitions[0]!, "equals", "paused");
    });

    expect(pushedUrls).toEqual(["/sessions?limit=20&status=paused"]);
  });

  it("resetea la paginación al limpiar filtros cuando la config lo pide", async () => {
    currentSearch = "page=3&limit=20&status=paused&taskId=A-123";
    const { useUrlDynamicFilters } = await import("./use-url-dynamic-filters");
    const { result } = renderHook(() => useUrlDynamicFilters(config));

    act(() => {
      result.current.clearFilters();
    });

    expect(pushedUrls).toEqual(["/sessions?limit=20"]);
  });

  it("preserva la paginación por defecto para no cambiar otros dominios sin opt-in", async () => {
    currentSearch = "page=7&limit=20";
    const { useUrlDynamicFilters } = await import("./use-url-dynamic-filters");
    const { result } = renderHook(() =>
      useUrlDynamicFilters(configWithoutPageReset),
    );

    act(() => {
      result.current.addFilter(
        configWithoutPageReset.definitions[0]!,
        "equals",
        "paused",
      );
    });

    expect(pushedUrls).toEqual(["/sessions?page=7&limit=20&status=paused"]);
  });

  it("lee filtros multiselect desde query params separados por comas", async () => {
    currentSearch = "status=queued,running&projectId=project-1,project-2";
    const { useUrlDynamicFilters } = await import("./use-url-dynamic-filters");
    const { result } = renderHook(() => useUrlDynamicFilters(multiSelectConfig));

    expect(result.current.appliedFilters).toEqual([
      expect.objectContaining({
        fieldId: "status",
        operator: "in",
        value: ["queued", "running"],
        displayValue: "Queued, Running",
      }),
      expect.objectContaining({
        fieldId: "projectId",
        operator: "in",
        value: ["project-1", "project-2"],
        displayValue: "Project 1, Project 2",
      }),
    ]);
  });

  it("escribe filtros multiselect en la URL con comas visibles y resetea la página", async () => {
    currentSearch = "page=3&limit=20";
    const { useUrlDynamicFilters } = await import("./use-url-dynamic-filters");
    const { result } = renderHook(() => useUrlDynamicFilters(multiSelectConfig));

    act(() => {
      result.current.addFilter(
        multiSelectConfig.definitions[0]!,
        "in",
        ["queued", "running"],
      );
    });

    expect(pushedUrls).toEqual(["/sessions?limit=20&status=queued,running"]);
  });
});

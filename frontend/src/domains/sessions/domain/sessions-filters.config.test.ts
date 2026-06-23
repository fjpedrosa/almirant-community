import { describe, expect, it } from "bun:test";
import { createSessionsFiltersConfig } from "./sessions-filters.config";

describe("createSessionsFiltersConfig", () => {
  it("configura los filtros de sesiones para resetear la paginación", () => {
    const config = createSessionsFiltersConfig([]);

    expect(config.resetPageOnChange).toBe(true);
  });

  it("expone el filtro paused con el valor que espera la API de sesiones", () => {
    const config = createSessionsFiltersConfig([]);
    const statusFilter = config.definitions.find((def) => def.id === "status");

    expect(statusFilter?.options).toContainEqual(expect.objectContaining({
      value: "paused",
      label: "Paused",
    }));
  });

  it("expone todos los estados soportados por /agent-jobs", () => {
    const config = createSessionsFiltersConfig([]);
    const statusFilter = config.definitions.find((def) => def.id === "status");

    expect(statusFilter?.options?.map((option) => option.value)).toEqual([
      "queued",
      "running",
      "finalizing",
      "waiting_for_input",
      "paused",
      "completed",
      "incomplete",
      "failed",
      "cancelled",
    ]);
  });

  it("mantiene disponibles todos los filtros soportados por /agent-jobs", () => {
    const config = createSessionsFiltersConfig([
      { value: "project-1", label: "Project 1" },
    ]);

    expect(config.definitions.map((def) => def.id)).toEqual([
      "projectId",
      "status",
      "jobType",
      "taskId",
    ]);
  });

  it("configura proyecto, estado y tipo de sesión como multiselect con operador in", () => {
    const config = createSessionsFiltersConfig([
      { value: "project-1", label: "Project 1", color: "#22c55e" },
    ]);

    const projectFilter = config.definitions.find((def) => def.id === "projectId");
    const statusFilter = config.definitions.find((def) => def.id === "status");
    const jobTypeFilter = config.definitions.find((def) => def.id === "jobType");

    expect(projectFilter).toMatchObject({
      type: "multi_select",
      operators: ["in"],
      defaultOperator: "in",
    });
    expect(statusFilter).toMatchObject({
      type: "multi_select",
      operators: ["in"],
      defaultOperator: "in",
    });
    expect(jobTypeFilter).toMatchObject({
      type: "multi_select",
      operators: ["in"],
      defaultOperator: "in",
    });
  });
});

import { describe, expect, it } from "bun:test";
import {
  getColumnActions,
  getColumnActionsByRole,
  getRunnerActionForRole,
  isActionAvailable,
  isActionAvailableByRole,
} from "./column-actions";

describe("column-actions", () => {
  it("permite re-lanzar implementacion AI en columnas in progress por nombre", () => {
    expect(getColumnActions("in progress")).toContain("implement-with-ai");
    expect(getColumnActions("in progress")).toContain("copy-implement-command");
    expect(isActionAvailable("in progress", "implement-with-ai")).toBe(true);
    expect(isActionAvailable("in progress", "copy-implement-command")).toBe(true);
  });

  it("permite re-lanzar implementacion AI en columnas in_progress por rol", () => {
    expect(getColumnActionsByRole("in_progress")).toContain("implement-with-ai");
    expect(getColumnActionsByRole("in_progress")).toContain("copy-implement-command");
    expect(isActionAvailableByRole("in_progress", "implement-with-ai")).toBe(true);
    expect(isActionAvailableByRole("in_progress", "copy-implement-command")).toBe(true);
    expect(getRunnerActionForRole("in_progress")).toBe("implement");
  });

  it("permite validar items en To Review (canónico) y Reviewing (legacy)", () => {
    expect(getColumnActions("To Review")).toContain("validate-with-ai");
    expect(getColumnActions("To Review")).toContain("ai-review");
    expect(isActionAvailable("To Review", "validate-with-ai")).toBe(true);

    // Compatibilidad con boards no migradas
    expect(getColumnActions("Reviewing")).toContain("validate-with-ai");
    expect(getColumnActions("Reviewing")).toContain("ai-review");

    expect(getColumnActionsByRole("review")).toContain("validate-with-ai");
    expect(getRunnerActionForRole("review")).toBe("validate");
  });

  it("limita acciones de columnas release a informacion por nombre (To Release y legacy Release)", () => {
    expect(getColumnActions("To Release")).toEqual(["info-popup"]);
    expect(isActionAvailable("To Release", "copy-prompt")).toBe(false);
    expect(isActionAvailable("To Release", "info-popup")).toBe(true);

    // Compatibilidad con boards no migradas
    expect(getColumnActions("Release")).toEqual(["info-popup"]);
    expect(isActionAvailable("Release", "info-popup")).toBe(true);
  });

  it("limita acciones de columnas release a informacion por rol", () => {
    expect(getColumnActionsByRole("release")).toEqual(["info-popup"]);
    expect(isActionAvailableByRole("release", "copy-prompt")).toBe(false);
    expect(isActionAvailableByRole("release", "info-popup")).toBe(true);
    expect(getRunnerActionForRole("release")).toBeNull();
  });
});

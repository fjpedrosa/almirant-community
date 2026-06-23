import { describe, expect, it } from "bun:test";
import { shouldLoadPlanningSessionFromUrl } from "./use-planning-session-lifecycle";

describe("shouldLoadPlanningSessionFromUrl", () => {
  it("carga la sesión de la URL cuando no coincide con el estado actual", () => {
    expect(
      shouldLoadPlanningSessionFromUrl({
        urlSessionId: "session-url",
        currentSessionId: "session-vieja",
        lastRequestedUrlSessionId: null,
        isLoadingFromUrl: false,
      }),
    ).toBe(true);
  });

  it("no recarga cuando la URL ya coincide con la sesión cargada", () => {
    expect(
      shouldLoadPlanningSessionFromUrl({
        urlSessionId: "session-url",
        currentSessionId: "session-url",
        lastRequestedUrlSessionId: null,
        isLoadingFromUrl: false,
      }),
    ).toBe(false);
  });

  it("evita duplicar una carga de URL ya solicitada", () => {
    expect(
      shouldLoadPlanningSessionFromUrl({
        urlSessionId: "session-url",
        currentSessionId: "session-vieja",
        lastRequestedUrlSessionId: "session-url",
        isLoadingFromUrl: false,
      }),
    ).toBe(false);
  });

  it("no inicia otra carga mientras una hidratación está en curso", () => {
    expect(
      shouldLoadPlanningSessionFromUrl({
        urlSessionId: "session-url",
        currentSessionId: "session-vieja",
        lastRequestedUrlSessionId: null,
        isLoadingFromUrl: true,
      }),
    ).toBe(false);
  });
});

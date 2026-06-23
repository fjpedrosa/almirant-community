import { describe, expect, it } from "bun:test";
import { shouldShowPlanningSeedContext } from "./planning-seed-visibility";

describe("shouldShowPlanningSeedContext", () => {
  it("mantiene visible el bloque de seeds al refrescar una sesion prewarm sin primer prompt", () => {
    expect(
      shouldShowPlanningSeedContext({
        attachedSeedCount: 2,
        isSessionActive: true,
        hasInjectedSeeds: false,
        isStarting: false,
        phase: "idle",
        hasStartedConversation: false,
      }),
    ).toBe(true);
  });

  it("oculta el bloque cuando la conversacion ya empezo", () => {
    expect(
      shouldShowPlanningSeedContext({
        attachedSeedCount: 2,
        isSessionActive: true,
        hasInjectedSeeds: false,
        isStarting: false,
        phase: "streaming",
        hasStartedConversation: true,
      }),
    ).toBe(false);
  });
});

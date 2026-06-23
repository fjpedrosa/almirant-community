import { describe, expect, it } from "bun:test";
import { shouldStartExistingPlanningSession } from "./use-planning-messages";

describe("shouldStartExistingPlanningSession", () => {
  it("arranca una sesion prewarmed cuando aun no hay mensajes del usuario", () => {
    expect(
      shouldStartExistingPlanningSession({
        existingSessionId: "session-1",
        sessionStatus: "active",
        hasUserMessages: false,
        hasPendingQuestion: false,
      }),
    ).toBe(true);
  });

  it("no reutiliza planning:start cuando hay un cuestionario pendiente", () => {
    expect(
      shouldStartExistingPlanningSession({
        existingSessionId: "session-1",
        sessionStatus: "active",
        hasUserMessages: false,
        hasPendingQuestion: true,
      }),
    ).toBe(false);
  });
});

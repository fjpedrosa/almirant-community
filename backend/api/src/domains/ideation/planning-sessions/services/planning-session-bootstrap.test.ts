import { describe, expect, it } from "bun:test";
import { buildPlanningSessionBootstrap } from "./planning-session-bootstrap";

describe("planning-session-bootstrap", () => {
  it("projects session.awaiting_user as a generic follow-up", () => {
    const projection = buildPlanningSessionBootstrap({
      sessionId: "session-1",
      events: [
        {
          sequenceNum: 1,
          kind: "agent.text",
          payload: { content: "Resumen del turno" },
          createdAt: new Date("2026-04-05T10:00:00.000Z"),
        },
        {
          sequenceNum: 2,
          kind: "session.idle",
          payload: { hasBackgroundAgents: false, isPlanningJob: true },
          createdAt: new Date("2026-04-05T10:00:01.000Z"),
        },
        {
          sequenceNum: 3,
          kind: "session.awaiting_user",
          payload: { prompt: "¿Como te gustaria continuar?" },
          createdAt: new Date("2026-04-05T10:00:02.000Z"),
        },
      ],
      userInputs: [],
    });

    expect(projection.baseState.messages).toHaveLength(1);
    expect(projection.baseState.messages[0]?.content).toBe("Resumen del turno");
    expect(projection.baseState.pendingQuestion).toBeNull();
    expect(projection.baseState.pendingFollowUp).toBe(true);
    expect(projection.baseState.followUpPrompt).toBe("¿Como te gustaria continuar?");
  });

  it("keeps explicit agent questions separate from generic follow-ups", () => {
    const projection = buildPlanningSessionBootstrap({
      sessionId: "session-2",
      events: [
        {
          sequenceNum: 1,
          kind: "agent.question",
          payload: {
            questionText: "Necesito mas detalle sobre el alcance",
            questionType: "free_text",
          },
          createdAt: new Date("2026-04-05T11:00:00.000Z"),
        },
      ],
      userInputs: [],
    });

    expect(projection.baseState.pendingQuestion).toEqual({
      questionId: "question-1",
      questionText: "Necesito mas detalle sobre el alcance",
      options: [],
      questionType: "free_text",
    });
    expect(projection.baseState.pendingFollowUp).toBe(false);
    expect(projection.baseState.followUpPrompt).toBeNull();
  });

  it("preserves grouped questions in pendingQuestion", () => {
    const projection = buildPlanningSessionBootstrap({
      sessionId: "session-3",
      events: [
        {
          sequenceNum: 1,
          kind: "agent.question",
          payload: {
            questionText: "Pregunta 1\nPregunta 2",
            options: ["A", "B", "C"],
            questions: [
              { text: "Pregunta 1", options: ["A", "B"] },
              { text: "Pregunta 2", options: ["C"] },
            ],
            questionType: "single_choice",
          },
          createdAt: new Date("2026-04-05T12:00:00.000Z"),
        },
      ],
      userInputs: [],
    });

    expect(projection.baseState.pendingQuestion).toEqual({
      questionId: "question-1",
      questionText: "Pregunta 1\nPregunta 2",
      options: ["A", "B", "C"],
      questions: [
        { text: "Pregunta 1", options: ["A", "B"] },
        { text: "Pregunta 2", options: ["C"] },
      ],
      questionType: "single_choice",
    });
  });
});

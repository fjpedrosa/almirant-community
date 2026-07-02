import { describe, expect, it } from "bun:test";
import { buildSkillValidationCanonicalEvents } from "./skill-validation-events";

describe("buildSkillValidationCanonicalEvents", () => {
  it("emite eventos canónicos de tool call para la validación del skill", () => {
    const events = buildSkillValidationCanonicalEvents({
      jobId: "job-1",
      threadId: "thread-1",
      webSessionId: "session-1",
      webWorkspaceId: "org-1",
      skillName: "ideate",
      nextSequence: (() => {
        let current = 0;
        return () => ++current;
      })(),
      now: () => 123,
    });

    expect(events).toHaveLength(2);
    const startEvent = events[0]?.event;
    expect(startEvent?.kind).toBe("agent.tool_call.start");
    if (startEvent?.kind !== "agent.tool_call.start") {
      throw new Error("Se esperaba un agent.tool_call.start");
    }
    expect(events[0]?.event).toEqual({
      kind: "agent.tool_call.start",
      toolCallId: expect.stringContaining("skill-ideate-"),
      toolName: "Skill",
      inputPreview: "skill: ideate",
    });
    expect(events[1]?.event).toEqual({
      kind: "agent.tool_call.result",
      toolCallId: startEvent.toolCallId,
      toolName: "Skill",
      success: true,
    });
  });

  it("emite eventos para web aunque no exista threadId", () => {
    const events = buildSkillValidationCanonicalEvents({
      jobId: "job-1",
      webSessionId: "session-1",
      webWorkspaceId: "org-1",
      skillName: "ideate",
      nextSequence: (() => {
        let current = 0;
        return () => ++current;
      })(),
      now: () => 456,
    });

    expect(events).toHaveLength(2);
    expect(events[0]?.threadId).toBe("");
    expect(events[1]?.threadId).toBe("");
    expect(events[0]?.event).toMatchObject({
      kind: "agent.tool_call.start",
      toolName: "Skill",
      inputPreview: "skill: ideate",
    });
  });

  it("no emite nada cuando falta el contexto de streaming web", () => {
    const events = buildSkillValidationCanonicalEvents({
      jobId: "job-1",
      skillName: "ideate",
      nextSequence: () => 1,
    });

    expect(events).toEqual([]);
  });
});

import { describe, expect, it } from "bun:test";
import { buildWaveMarkerCommand } from "@almirant/canonical-events";
import { emitToolSpecificEvents } from "./canonical-helpers.js";

const bashInput = (command: string) => ({ input: { command } });

describe("emitToolSpecificEvents — wave markers", () => {
  it("emits agent.wave.start from a Bash wave.start marker (no bash.execute)", () => {
    const command = buildWaveMarkerCommand({
      type: "wave.start",
      agents: [
        { agent: "frontend-developer", taskId: "A-425", title: "Drawer" },
        { agent: "backend-architect", taskId: "A-426", title: "API" },
      ],
    });

    const events = emitToolSpecificEvents("Bash", "tc-1", bashInput(command), "");

    expect(events).toEqual([
      {
        kind: "agent.wave.start",
        agents: [
          { agent: "frontend-developer", taskId: "A-425", title: "Drawer" },
          { agent: "backend-architect", taskId: "A-426", title: "API" },
        ],
      },
    ]);
    // The sentinel echo must NOT surface as a shell command.
    expect(events.some((e) => e.kind === "agent.bash.execute")).toBe(false);
  });

  it("emits agent.wave.agent_done from a Bash wave.agent_done marker", () => {
    const command = buildWaveMarkerCommand({
      type: "wave.agent_done",
      agent: "backend-architect",
      taskId: "A-426",
      success: false,
      reason: "type error",
    });

    const events = emitToolSpecificEvents("Bash", "tc-2", bashInput(command), "");

    expect(events).toEqual([
      {
        kind: "agent.wave.agent_done",
        agent: "backend-architect",
        taskId: "A-426",
        success: false,
        reason: "type error",
      },
    ]);
  });

  it("emits agent.wave.end from a Bash wave.end marker", () => {
    const command = buildWaveMarkerCommand({
      type: "wave.end",
      successCount: 1,
      totalCount: 2,
    });

    const events = emitToolSpecificEvents("Bash", "tc-3", bashInput(command), "");

    expect(events).toEqual([
      { kind: "agent.wave.end", successCount: 1, totalCount: 2 },
    ]);
  });

  it("INV-1: wave.start taskIds exactly match the emitted wave.agent_done taskIds", () => {
    const agents = [
      { agent: "frontend-developer", taskId: "A-425", title: "Drawer" },
      { agent: "backend-architect", taskId: "A-426", title: "API" },
    ];

    const startEvents = emitToolSpecificEvents(
      "Bash",
      "tc-start",
      bashInput(buildWaveMarkerCommand({ type: "wave.start", agents })),
      "",
    );
    const startEvent = startEvents[0];
    if (startEvent.kind !== "agent.wave.start") throw new Error("expected wave.start");
    const pending = new Set(startEvent.agents.map((a) => a.taskId));

    for (const { agent, taskId } of agents) {
      const doneEvents = emitToolSpecificEvents(
        "Bash",
        `tc-${taskId}`,
        bashInput(
          buildWaveMarkerCommand({ type: "wave.agent_done", agent, taskId, success: true }),
        ),
        "",
      );
      const doneEvent = doneEvents[0];
      if (doneEvent.kind !== "agent.wave.agent_done") throw new Error("expected agent_done");
      pending.delete(doneEvent.taskId);
    }

    expect([...pending]).toEqual([]);
  });

  // ---- additive: normal Bash still works ----

  it("still emits agent.bash.execute for a normal (non-marker) Bash command", () => {
    const events = emitToolSpecificEvents(
      "Bash",
      "tc-4",
      bashInput("bun test services/runner"),
      "",
    );

    expect(events).toEqual([
      {
        kind: "agent.bash.execute",
        toolCallId: "tc-4",
        command: "bun test services/runner",
        description: undefined,
      },
    ]);
  });
});

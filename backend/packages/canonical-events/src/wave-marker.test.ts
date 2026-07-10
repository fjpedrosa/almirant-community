import { describe, expect, it } from "bun:test";
import {
  WAVE_MARKER_SENTINEL,
  buildWaveMarkerCommand,
  parseWaveMarker,
} from "./wave-marker";
import type {
  AgentWaveDoneEvent,
  AgentWaveEndEvent,
  AgentWaveStartEvent,
} from "./index";

describe("parseWaveMarker", () => {
  // ---- wave.start ----

  it("maps a wave.start marker to agent.wave.start with all agents", () => {
    const command = buildWaveMarkerCommand({
      type: "wave.start",
      agents: [
        { agent: "frontend-developer", taskId: "A-425", title: "Drawer component" },
        { agent: "backend-architect", taskId: "A-426", title: "API endpoint" },
      ],
    });

    const events = parseWaveMarker(command);

    expect(events).toEqual([
      {
        kind: "agent.wave.start",
        agents: [
          { agent: "frontend-developer", taskId: "A-425", title: "Drawer component" },
          { agent: "backend-architect", taskId: "A-426", title: "API endpoint" },
        ],
      },
    ]);
  });

  it("drops malformed agent entries but keeps valid ones in wave.start", () => {
    const command = `${WAVE_MARKER_SENTINEL} ${JSON.stringify({
      type: "wave.start",
      agents: [
        { agent: "frontend-developer", taskId: "A-425", title: "Drawer" },
        { agent: "backend-architect", taskId: 123, title: "Bad taskId" },
        { taskId: "A-427", title: "Missing agent" },
      ],
    })}`;

    const events = parseWaveMarker(command);

    expect(events).toHaveLength(1);
    const start = events[0] as AgentWaveStartEvent;
    expect(start.kind).toBe("agent.wave.start");
    expect(start.agents).toEqual([
      { agent: "frontend-developer", taskId: "A-425", title: "Drawer" },
    ]);
  });

  // ---- wave.agent_done ----

  it("maps a successful wave.agent_done marker", () => {
    const command = buildWaveMarkerCommand({
      type: "wave.agent_done",
      agent: "frontend-developer",
      taskId: "A-425",
      success: true,
    });

    const events = parseWaveMarker(command);

    expect(events).toEqual([
      {
        kind: "agent.wave.agent_done",
        agent: "frontend-developer",
        taskId: "A-425",
        success: true,
      },
    ]);
  });

  it("maps a failed wave.agent_done marker keeping the reason", () => {
    const command = buildWaveMarkerCommand({
      type: "wave.agent_done",
      agent: "backend-architect",
      taskId: "A-426",
      success: false,
      reason: "type error in routes/items.ts",
    });

    const events = parseWaveMarker(command);

    expect(events).toEqual([
      {
        kind: "agent.wave.agent_done",
        agent: "backend-architect",
        taskId: "A-426",
        success: false,
        reason: "type error in routes/items.ts",
      },
    ]);
  });

  // ---- wave.end ----

  it("maps a wave.end marker to agent.wave.end", () => {
    const command = buildWaveMarkerCommand({
      type: "wave.end",
      successCount: 1,
      totalCount: 2,
    });

    const events = parseWaveMarker(command);

    expect(events).toEqual([
      { kind: "agent.wave.end", successCount: 1, totalCount: 2 },
    ]);
  });

  // ---- robustness / additivity ----

  it("returns [] for a normal command without the sentinel", () => {
    expect(parseWaveMarker("bun test services/runner")).toEqual([]);
    expect(parseWaveMarker("echo hello world")).toEqual([]);
  });

  it("returns [] for malformed JSON after the sentinel", () => {
    expect(parseWaveMarker(`${WAVE_MARKER_SENTINEL} {not json`)).toEqual([]);
  });

  it("returns [] for an unknown marker type", () => {
    const command = `${WAVE_MARKER_SENTINEL} ${JSON.stringify({ type: "wave.other" })}`;
    expect(parseWaveMarker(command)).toEqual([]);
  });

  it("tolerates the marker embedded in a shell-quoted echo command", () => {
    const command = `echo '${WAVE_MARKER_SENTINEL} ${JSON.stringify({
      type: "wave.end",
      successCount: 2,
      totalCount: 3,
    })}'`;

    const events = parseWaveMarker(command);
    const end = events[0] as AgentWaveEndEvent;
    expect(end).toEqual({ kind: "agent.wave.end", successCount: 2, totalCount: 3 });
  });

  // ---- INV-1 contract: start taskIds must exactly match agent_done taskIds ----

  it("emits taskIds in wave.start that exactly match the wave.agent_done taskIds (INV-1)", () => {
    const agents = [
      { agent: "frontend-developer", taskId: "A-425", title: "Drawer" },
      { agent: "backend-architect", taskId: "A-426", title: "API" },
    ];

    const startEvents = parseWaveMarker(
      buildWaveMarkerCommand({ type: "wave.start", agents }),
    );
    const start = startEvents[0] as AgentWaveStartEvent;
    const pending = new Set(start.agents.map((a) => a.taskId));

    // One agent_done per task clears the pending set (success OR fail both clear).
    for (const { agent, taskId } of agents) {
      const doneEvents = parseWaveMarker(
        buildWaveMarkerCommand({
          type: "wave.agent_done",
          agent,
          taskId,
          success: taskId === "A-426" ? false : true,
        }),
      );
      const done = doneEvents[0] as AgentWaveDoneEvent;
      pending.delete(done.taskId);
    }

    expect([...pending]).toEqual([]);
  });
});

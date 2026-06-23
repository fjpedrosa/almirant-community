import { describe, expect, it } from "bun:test";
import { buildSessionTimelinePhases } from "./use-session-event-timeline";
import type { AgentLogChunk } from "@/domains/shared/domain/types";

const makeChunk = (
  phase: string,
  eventType: string,
  timestamp: string,
  seq: number,
  message = `${phase}:${eventType}`,
): AgentLogChunk => ({
  id: `${phase}-${seq}`,
  seq,
  level: "info",
  phase,
  eventType,
  message,
  timestamp,
});

/** Pick only the keys we assert on so the test is immune to extra fields. */
const pick = <T extends object>(
  obj: T,
  keys: Array<keyof T>,
): Partial<T> => {
  const result: Record<string, unknown> = {};
  for (const key of keys) {
    result[String(key)] = obj[key];
  }
  return result as Partial<T>;
};

describe("buildSessionTimelinePhases", () => {
  it("groups runtime phases into a compact flow for implementation jobs", () => {
    const chunks: AgentLogChunk[] = [
      makeChunk("claim", "job.claimed", "2026-04-05T00:00:01.000Z", 1),
      makeChunk("config", "provider_key.resolved", "2026-04-05T00:00:02.000Z", 2),
      makeChunk("workspace", "workspace.ready", "2026-04-05T00:00:03.000Z", 3),
      makeChunk("session", "prompt.sent", "2026-04-05T00:00:04.000Z", 4),
      makeChunk("transcript", "message.part.delta", "2026-04-05T00:00:05.000Z", 5),
      makeChunk("push", "push.success", "2026-04-05T00:00:06.000Z", 6),
      makeChunk("finish", "job.completed", "2026-04-05T00:00:07.000Z", 7),
    ];

    const result = buildSessionTimelinePhases(chunks, "implementation", false);
    const keys: Array<keyof (typeof result)[number]> = ["id", "label", "status", "details"];
    const simplified = result.map((p) => pick(p, keys));

    expect(simplified).toEqual([
      { id: "claim", label: "Claim", status: "done", details: ["Claim"] },
      { id: "prepare", label: "Prepare", status: "done", details: ["Config", "Workspace"] },
      { id: "execute", label: "Execution", status: "done", details: ["Session", "Transcript"] },
      { id: "git", label: "Commit & PR", status: "done", details: ["Push"] },
      { id: "finish", label: "Finish", status: "done", details: ["Finish"] },
    ]);
  });

  it("marks the last observed step as active while the session is live", () => {
    const chunks: AgentLogChunk[] = [
      makeChunk("claim", "job.claimed", "2026-04-05T00:00:01.000Z", 1),
      makeChunk("session", "prompt.sent", "2026-04-05T00:00:02.000Z", 2),
      makeChunk("transcript", "message.part.delta", "2026-04-05T00:00:03.000Z", 3),
    ];

    const phases = buildSessionTimelinePhases(chunks, "implementation", true);
    const last = phases.at(-1)!;

    expect(last.id).toBe("execute");
    expect(last.status).toBe("active");
  });

  it("keeps unknown phases visible as a fallback instead of dropping them", () => {
    const chunks: AgentLogChunk[] = [
      makeChunk("custom-phase", "custom.event", "2026-04-05T00:00:01.000Z", 1),
    ];

    const result = buildSessionTimelinePhases(chunks, "implementation", false);

    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("custom-phase");
    expect(result[0].label).toBe("Custom-phase");
    expect(result[0].status).toBe("done");
  });

  it("expone waves de implementación con estado done, active y pending", () => {
    const chunks: AgentLogChunk[] = [
      makeChunk("claim", "job.claimed", "2026-04-05T00:00:01.000Z", 1),
      makeChunk("config", "provider_key.resolved", "2026-04-05T00:00:02.000Z", 2),
      makeChunk(
        "transcript",
        "raw_output",
        "2026-04-05T00:00:03.000Z",
        3,
        [
          "Wave 1: 5 tasks",
          "Wave 2 (after Wave 1): 3 tasks",
          "Wave 3 (after Wave 2): 1 task",
        ].join("\n"),
      ),
      makeChunk(
        "transcript",
        "raw_output",
        "2026-04-05T00:00:04.000Z",
        4,
        JSON.stringify({
          name: "TodoWrite",
          input: {
            todos: [
              {
                content: "Wave 1 Sub-batch 1: ZC-1, ZC-2",
                status: "completed",
              },
              {
                content: "Wave 2 Sub-batch 1: ZC-3, ZC-4",
                status: "in_progress",
              },
            ],
          },
        }),
      ),
    ];

    const result = buildSessionTimelinePhases(chunks, "implementation", true);
    const simplified = result.map((phase) =>
      pick(phase, ["id", "label", "status", "details"]),
    );

    expect(simplified).toEqual([
      { id: "claim", label: "Claim", status: "done", details: ["Claim"] },
      { id: "prepare", label: "Prepare", status: "done", details: ["Config"] },
      { id: "wave-1", label: "Wave 1", status: "done", details: ["5 tasks"] },
      { id: "wave-2", label: "Wave 2", status: "active", details: ["3 tasks"] },
      { id: "wave-3", label: "Wave 3", status: "pending", details: ["1 task"] },
    ]);
  });

  it("infers previous waves are done when a later wave starts without TodoWrite status snapshots", () => {
    const chunks: AgentLogChunk[] = [
      makeChunk("claim", "job.claimed", "2026-04-05T00:00:01.000Z", 1),
      makeChunk(
        "transcript",
        "agent.text.complete",
        "2026-04-05T00:00:02.000Z",
        2,
        [
          "Execution plan:",
          "Wave 1: 2 tasks",
          "Wave 2 (after Wave 1): 5 tasks",
          "Wave 3 (after Wave 2): 1 task",
        ].join("\n"),
      ),
      makeChunk(
        "transcript",
        "agent.text.complete",
        "2026-04-05T00:00:10.000Z",
        3,
        "Now launching Wave 1 -- moving 2 tasks to In Progress.",
      ),
      makeChunk(
        "transcript",
        "agent.text.complete",
        "2026-04-05T00:01:00.000Z",
        4,
        "Now launching Wave 2 -- moving 5 tasks to In Progress.",
      ),
    ];

    const phases = buildSessionTimelinePhases(chunks, "implementation", true);
    const wavePhases = phases.filter((phase) => phase.id.startsWith("wave-"));

    expect(wavePhases.map((phase) => pick(phase, ["id", "status", "startedAt"]))).toEqual([
      {
        id: "wave-1",
        status: "done",
        startedAt: "2026-04-05T00:00:10.000Z",
      },
      {
        id: "wave-2",
        status: "active",
        startedAt: "2026-04-05T00:01:00.000Z",
      },
      { id: "wave-3", status: "pending", startedAt: null },
    ]);
  });

  it("does not mark Commit & PR done while an implementation wave is still active", () => {
    const chunks: AgentLogChunk[] = [
      makeChunk("claim", "job.claimed", "2026-04-05T00:00:01.000Z", 1),
      makeChunk("config", "provider_key.resolved", "2026-04-05T00:00:02.000Z", 2),
      makeChunk(
        "transcript",
        "agent.text.complete",
        "2026-04-05T00:00:03.000Z",
        3,
        "Wave 1: 2 tasks",
      ),
      makeChunk(
        "transcript",
        "agent.text.complete",
        "2026-04-05T00:00:04.000Z",
        4,
        "Now launching Wave 1 -- moving 2 tasks to In Progress.",
      ),
      makeChunk("push", "push.serve_success", "2026-04-05T00:00:05.000Z", 5),
      makeChunk("pr", "pr.draft_created", "2026-04-05T00:00:06.000Z", 6),
    ];

    const phases = buildSessionTimelinePhases(chunks, "implementation", true);

    expect(phases.map((phase) => pick(phase, ["id", "status"]))).toEqual([
      { id: "claim", status: "done" },
      { id: "prepare", status: "done" },
      { id: "wave-1", status: "active" },
    ]);
  });

  it("marks Commit & PR active after implementation waves complete while the session is live", () => {
    const chunks: AgentLogChunk[] = [
      makeChunk("claim", "job.claimed", "2026-04-05T00:00:01.000Z", 1),
      makeChunk(
        "transcript",
        "agent.text.complete",
        "2026-04-05T00:00:03.000Z",
        2,
        JSON.stringify({
          name: "TodoWrite",
          input: {
            todos: [
              {
                content: "Wave 1 Sub-batch 1: A-1, A-2",
                status: "completed",
              },
            ],
          },
        }),
      ),
      makeChunk("push", "push.serve_success", "2026-04-05T00:00:05.000Z", 3),
    ];

    const phases = buildSessionTimelinePhases(chunks, "implementation", true);
    const gitPhase = phases.find((phase) => phase.id === "git");

    expect(gitPhase).toMatchObject({
      id: "git",
      label: "Commit & PR",
      status: "active",
    });
  });
});

import { describe, expect, it, mock } from "bun:test";
import type { CanonicalEvent } from "@almirant/canonical-events";
import { createCanonicalTextCoalescer } from "../canonical-text-coalescer";

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

describe("createCanonicalTextCoalescer", () => {
  it("coalesces 1800 consecutive agent.text deltas into a single agent.text", () => {
    const out: CanonicalEvent[] = [];
    const coalescer = createCanonicalTextCoalescer({
      onFlush: (event) => {
        out.push(event);
      },
      idleMs: 1_000,
    });

    let expectedFull = "";
    for (let i = 0; i < 1800; i += 1) {
      const fragment = `delta-${i} `;
      expectedFull += fragment;
      coalescer.push({ kind: "agent.text", content: fragment });
    }
    coalescer.flush();
    coalescer.destroy();

    expect(out).toHaveLength(1);
    expect(out[0]?.kind).toBe("agent.text");
    if (out[0]?.kind === "agent.text") {
      expect(out[0].content).toBe(expectedFull);
    }
  });

  it("coalesces 3890 consecutive agent.thinking deltas into a single agent.thinking", () => {
    const out: CanonicalEvent[] = [];
    const coalescer = createCanonicalTextCoalescer({
      onFlush: (event) => {
        out.push(event);
      },
      idleMs: 1_000,
    });

    let expectedFull = "";
    for (let i = 0; i < 3890; i += 1) {
      const fragment = `t${i} `;
      expectedFull += fragment;
      coalescer.push({ kind: "agent.thinking", content: fragment });
    }
    coalescer.flush();
    coalescer.destroy();

    expect(out).toHaveLength(1);
    expect(out[0]?.kind).toBe("agent.thinking");
    if (out[0]?.kind === "agent.thinking") {
      expect(out[0].content).toBe(expectedFull);
    }
  });

  it("flushes the buffer immediately when a non-coalesceable event arrives, in order", () => {
    const out: CanonicalEvent[] = [];
    const coalescer = createCanonicalTextCoalescer({
      onFlush: (event) => {
        out.push(event);
      },
      idleMs: 1_000,
    });

    coalescer.push({ kind: "agent.text", content: "hello " });
    coalescer.push({ kind: "agent.text", content: "world" });
    coalescer.push({
      kind: "agent.tool_call.start",
      toolName: "Read",
      toolCallId: "call-1",
    });
    coalescer.push({ kind: "agent.text", content: "after" });
    coalescer.flush();
    coalescer.destroy();

    expect(out).toHaveLength(3);
    expect(out[0]?.kind).toBe("agent.text");
    expect((out[0] as { content: string }).content).toBe("hello world");
    expect(out[1]?.kind).toBe("agent.tool_call.start");
    expect(out[2]?.kind).toBe("agent.text");
    expect((out[2] as { content: string }).content).toBe("after");
  });

  it("flushes a text run before a thinking run and vice-versa (different coalesce kinds)", () => {
    const out: CanonicalEvent[] = [];
    const coalescer = createCanonicalTextCoalescer({
      onFlush: (event) => {
        out.push(event);
      },
      idleMs: 1_000,
    });

    coalescer.push({ kind: "agent.thinking", content: "let me think " });
    coalescer.push({ kind: "agent.thinking", content: "about it" });
    coalescer.push({ kind: "agent.text", content: "ok " });
    coalescer.push({ kind: "agent.text", content: "done" });
    coalescer.flush();
    coalescer.destroy();

    expect(out).toHaveLength(2);
    expect(out[0]?.kind).toBe("agent.thinking");
    expect((out[0] as { content: string }).content).toBe("let me think about it");
    expect(out[1]?.kind).toBe("agent.text");
    expect((out[1] as { content: string }).content).toBe("ok done");
  });

  it("flushes after the configured idle window without explicit flush", async () => {
    const out: CanonicalEvent[] = [];
    const coalescer = createCanonicalTextCoalescer({
      onFlush: (event) => {
        out.push(event);
      },
      idleMs: 30,
    });

    coalescer.push({ kind: "agent.text", content: "hello " });
    coalescer.push({ kind: "agent.text", content: "world" });

    expect(out).toHaveLength(0); // not flushed yet

    await sleep(80);
    expect(out).toHaveLength(1);
    expect(out[0]?.kind).toBe("agent.text");
    expect((out[0] as { content: string }).content).toBe("hello world");
    coalescer.destroy();
  });

  it("respects an existing agent.text.complete and uses its fullText, ignoring earlier deltas", () => {
    const out: CanonicalEvent[] = [];
    const coalescer = createCanonicalTextCoalescer({
      onFlush: (event) => {
        out.push(event);
      },
      idleMs: 1_000,
    });

    coalescer.push({ kind: "agent.text", content: "hello " });
    coalescer.push({ kind: "agent.text", content: "wor" });
    coalescer.push({ kind: "agent.text.complete", fullText: "hello world" });
    coalescer.flush();
    coalescer.destroy();

    expect(out).toHaveLength(1);
    expect(out[0]?.kind).toBe("agent.text.complete");
    expect((out[0] as { fullText: string }).fullText).toBe("hello world");
  });

  it("passes through non-text/thinking events unchanged and without buffering", () => {
    const out: CanonicalEvent[] = [];
    const coalescer = createCanonicalTextCoalescer({
      onFlush: (event) => {
        out.push(event);
      },
      idleMs: 1_000,
    });

    const idleEvent: CanonicalEvent = {
      kind: "session.idle",
      hasBackgroundAgents: false,
      isPlanningJob: false,
    };
    coalescer.push(idleEvent);
    coalescer.destroy();

    expect(out).toHaveLength(1);
    expect(out[0]).toEqual(idleEvent);
  });

  it("destroy() flushes any pending buffer", () => {
    const out: CanonicalEvent[] = [];
    const onFlush = mock((event: CanonicalEvent) => {
      out.push(event);
    });
    const coalescer = createCanonicalTextCoalescer({
      onFlush,
      idleMs: 10_000,
    });

    coalescer.push({ kind: "agent.text", content: "pending" });
    coalescer.destroy();

    expect(onFlush).toHaveBeenCalledTimes(1);
    expect(out[0]?.kind).toBe("agent.text");
    expect((out[0] as { content: string }).content).toBe("pending");
  });

  // -------------------------------------------------------------------------
  // Regression: 383d0e9 caused multi-window text streams to surface as several
  // `agent.text.complete` events, each with only the deltas of one coalesce
  // window — never the full message. Downstream consumers ("pick the last
  // agent.text.complete" in the frontend, `extractStructuredSummary` over a
  // single fullText in the runner-implement validator, the PR-summary update)
  // therefore see only one fragment of a long message.
  //
  // Contract enforced by these tests:
  //   - `agent.text.complete` is emitted ONLY when the source produced an
  //     explicit fullText snapshot during the window. Its `fullText` is the
  //     full text of the message at that point, not "deltas seen since the
  //     previous flush".
  //   - When the window only contained `agent.text` deltas, the coalescer
  //     emits `agent.text` with the concatenated buffer. Multiple consecutive
  //     `agent.text` events from successive windows can be safely re-joined
  //     downstream by simple concatenation.
  // -------------------------------------------------------------------------
  describe("regression: fragmenting agent.text.complete (PR #32 / opencode UI)", () => {
    it("emits agent.text (NOT agent.text.complete) when the buffer holds only deltas", () => {
      const out: CanonicalEvent[] = [];
      const coalescer = createCanonicalTextCoalescer({
        onFlush: (event) => {
          out.push(event);
        },
        idleMs: 1_000,
      });

      coalescer.push({ kind: "agent.text", content: "Loading " });
      coalescer.push({ kind: "agent.text", content: "skill " });
      coalescer.push({ kind: "agent.text", content: "(+more+iog+test)" });
      coalescer.flush();
      coalescer.destroy();

      expect(out).toHaveLength(1);
      expect(out[0]?.kind).toBe("agent.text");
      if (out[0]?.kind === "agent.text") {
        expect(out[0].content).toBe("Loading skill (+more+iog+test)");
      }
    });

    it("emits agent.text.complete only when an explicit complete arrived during the window", () => {
      const out: CanonicalEvent[] = [];
      const coalescer = createCanonicalTextCoalescer({
        onFlush: (event) => {
          out.push(event);
        },
        idleMs: 1_000,
      });

      coalescer.push({ kind: "agent.text", content: "hello " });
      coalescer.push({ kind: "agent.text", content: "wor" });
      coalescer.push({ kind: "agent.text.complete", fullText: "hello world" });
      coalescer.flush();
      coalescer.destroy();

      expect(out).toHaveLength(1);
      expect(out[0]?.kind).toBe("agent.text.complete");
      if (out[0]?.kind === "agent.text.complete") {
        expect(out[0].fullText).toBe("hello world");
      }
    });

    it("multiple idle-flush cycles in a single message produce agent.text events that re-concatenate to the original (screenshot scenario)", async () => {
      const out: CanonicalEvent[] = [];
      const coalescer = createCanonicalTextCoalescer({
        onFlush: (event) => {
          out.push(event);
        },
        idleMs: 30,
      });

      // Window 1: short burst, then idle past the flush window.
      coalescer.push({ kind: "agent.text", content: "Loading " });
      coalescer.push({ kind: "agent.text", content: "skill " });
      await sleep(60);

      // Window 2: another short burst, then idle.
      coalescer.push({ kind: "agent.text", content: "(+more+iog+test). " });
      await sleep(60);

      // Window 3: trailing content drained on destroy().
      coalescer.push({
        kind: "agent.text",
        content: "13/13: Retrying other tests with longer timeout...",
      });
      coalescer.destroy();

      expect(out).toHaveLength(3);
      for (const event of out) {
        expect(event.kind).toBe("agent.text");
      }
      const concatenated = out
        .map((event) => (event as { content: string }).content)
        .join("");
      expect(concatenated).toBe(
        "Loading skill (+more+iog+test). 13/13: Retrying other tests with longer timeout...",
      );
    });

    it("preserves a `## Summary` block split across coalesce windows when concatenated downstream (regression: PR body truncated to '| ZC')", async () => {
      const out: CanonicalEvent[] = [];
      const coalescer = createCanonicalTextCoalescer({
        onFlush: (event) => {
          out.push(event);
        },
        idleMs: 30,
      });

      // Realistic shape of the PR #32 stream: the runner-implement summary
      // arrives as a long stream of text deltas that crosses multiple idle
      // windows. Pre-fix, each window became its own `agent.text.complete`
      // and validator.extractStructuredSummary() returned only the first
      // fragment ("## Summary ... | ZC"). Post-fix, the deltas remain
      // `agent.text` so the validator's accumulated-text fallback finds the
      // full block.
      const fragments = [
        "All tasks completed.\n\n## Summary\n\n**Total**: 3 | **Completed**: 3\n\n| Task | Title | Status | Commit |\n|------|-------|--------|--------|\n| ZC",
        "-57 | Adapter MailSlurp | :white_check_mark: Completed | `9bf8c94` |\n| ZC-56 | Generador identidades sintéticas | :white_check_mark: Completed | `9bf8c94` |\n| ZC-58 | Política \"no nombres re",
        "ales\" | :white_check_mark: Completed | `9bf8c94` |\n\n### Branch & PR\nPR: https://github.com/example/repo/pull/32",
      ];

      for (const fragment of fragments) {
        coalescer.push({ kind: "agent.text", content: fragment });
        await sleep(60);
      }
      coalescer.destroy();

      expect(out).toHaveLength(3);
      for (const event of out) {
        expect(event.kind).toBe("agent.text");
      }

      const reconstructed = out
        .map((event) => (event as { content: string }).content)
        .join("");

      // The full Summary block (including the entire table and Branch & PR
      // section) survives concatenation. This is what the runner-implement
      // validator's accumulatedAgentText fallback consumes.
      expect(reconstructed).toContain("## Summary");
      expect(reconstructed).toContain("ZC-57");
      expect(reconstructed).toContain("ZC-56");
      expect(reconstructed).toContain("ZC-58");
      expect(reconstructed).toContain("https://github.com/example/repo/pull/32");
    });
  });
});

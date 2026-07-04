import { describe, expect, it } from "bun:test";
import {
  resolvePromptCopyData,
  resolveSavedPrompt,
} from "./resolve-prompt-copy-data";

// Phase 5 (board perf): board copy actions must load the FULL work item on
// demand (the slim ?view=board list omits description text + prompt/DoD blobs).
// These use-cases fetch by id via the injected getter and build the prompt
// fields from that full item — never from the slim list row.

describe("resolvePromptCopyData", () => {
  it("fetches the full item by id and builds prompt fields from IT (not the list row)", async () => {
    const calls: string[] = [];
    const get = async (id: string) => {
      calls.push(id);
      return {
        id,
        title: "Full title",
        description: "The full description text",
        metadata: { definitionOfDone: "The full DoD", generatedPrompt: "p" },
      };
    };

    const data = await resolvePromptCopyData("wi-1", get);

    expect(calls).toEqual(["wi-1"]);
    expect(data).toEqual({
      id: "wi-1",
      title: "Full title",
      description: "The full description text",
      definitionOfDone: "The full DoD",
    });
  });

  it("defaults missing description/DoD to empty strings", async () => {
    const get = async (id: string) => ({
      id,
      title: "T",
      description: null,
      metadata: {},
    });

    const data = await resolvePromptCopyData("wi-2", get);

    expect(data.description).toBe("");
    expect(data.definitionOfDone).toBe("");
  });
});

describe("resolveSavedPrompt", () => {
  it("returns metadata.generatedPrompt from the FULL item", async () => {
    const calls: string[] = [];
    const get = async (id: string) => {
      calls.push(id);
      return { id, title: "T", metadata: { generatedPrompt: "SAVED PROMPT" } };
    };

    const prompt = await resolveSavedPrompt("wi-3", get);

    expect(calls).toEqual(["wi-3"]);
    expect(prompt).toBe("SAVED PROMPT");
  });

  it("returns null when the full item has no saved prompt", async () => {
    const get = async (id: string) => ({ id, title: "T", metadata: {} });
    expect(await resolveSavedPrompt("wi-4", get)).toBeNull();
  });
});

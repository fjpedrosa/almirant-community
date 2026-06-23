import { describe, it, expect } from "bun:test";
import {
  createDashboardState,
  renderDashboardEmbed,
  formatToolAction,
  parseToolInput,
  dashboardSetToolRunning,
  dashboardCompleteCurrentTool,
  dashboardAddTokens,
} from "./dashboard";

describe("createDashboardState", () => {
  it("creates state with defaults", () => {
    const state = createDashboardState({ title: "Test", model: "gpt-4" });
    expect(state.title).toBe("Test");
    expect(state.model).toBe("gpt-4");
    expect(state.status).toBe("running");
    expect(state.recentActions).toEqual([]);
    expect(state.tokens).toEqual({ in: 0, out: 0 });
  });
});

describe("formatToolAction", () => {
  it("formats read tool with file path", () => {
    expect(formatToolAction("read", { file_path: "/workspace/repo/src/index.ts" }))
      .toBe("read /workspace/repo/src/index.ts");
  });

  it("shortens long paths", () => {
    const longPath = "/workspace/repo/src/very/deep/nested/path/to/some/file.ts";
    const result = formatToolAction("read", { file_path: longPath });
    expect(result).toContain("...");
    expect(result.length).toBeLessThan(70);
  });

  it("formats bash tool with command", () => {
    expect(formatToolAction("bash", { command: "bun run type-check" }))
      .toBe("bash `bun run type-check`");
  });

  it("formats grep tool", () => {
    expect(formatToolAction("grep", { pattern: "TODO" }))
      .toBe("grep `TODO`");
  });

  it("formats MCP tools", () => {
    expect(formatToolAction("mcp__almirant__list_work_items"))
      .toBe("mcp almirant/list_work_items");
  });

  it("falls back to raw tool name", () => {
    expect(formatToolAction("custom_tool")).toBe("custom_tool");
  });
});

describe("parseToolInput", () => {
  it("passes through objects", () => {
    expect(parseToolInput({ key: "val" })).toEqual({ key: "val" });
  });

  it("parses JSON strings", () => {
    expect(parseToolInput('{"key":"val"}')).toEqual({ key: "val" });
  });

  it("returns undefined for invalid input", () => {
    expect(parseToolInput("not json")).toBeUndefined();
    expect(parseToolInput(42)).toBeUndefined();
    expect(parseToolInput(null)).toBeUndefined();
  });
});

describe("dashboard state mutations", () => {
  it("sets and clears current action via tool lifecycle", () => {
    const state = createDashboardState({ title: "t", model: "m" });

    dashboardSetToolRunning(state, "read", "read src/index.ts");
    expect(state.currentAction?.summary).toBe("read src/index.ts");

    dashboardCompleteCurrentTool(state, "read", "read src/index.ts");
    expect(state.currentAction).toBeUndefined();
    expect(state.recentActions).toHaveLength(1);
    expect(state.recentActions[0].status).toBe("completed");
  });

  it("caps recent actions at 8", () => {
    const state = createDashboardState({ title: "t", model: "m" });
    for (let i = 0; i < 12; i++) {
      dashboardCompleteCurrentTool(state, "read", `action ${i}`);
    }
    expect(state.recentActions).toHaveLength(8);
    expect(state.recentActions[0].summary).toBe("action 11");
  });

  it("adds tokens", () => {
    const state = createDashboardState({ title: "t", model: "m" });
    dashboardAddTokens(state, 100, 50);
    dashboardAddTokens(state, 200, 30);
    expect(state.tokens).toEqual({ in: 300, out: 80 });
  });
});

describe("renderDashboardEmbed", () => {
  it("renders a valid embed with running state", () => {
    const state = createDashboardState({ title: "Test Job", model: "glm-5" });
    dashboardSetToolRunning(state, "read", "read src/foo.ts");

    const payload = renderDashboardEmbed(state);

    expect(payload.embeds).toHaveLength(1);
    const embed = payload.embeds![0];
    expect(embed.title).toBe("Test Job");
    expect(embed.description).toContain("read src/foo.ts");
    expect(embed.color).toBe(0x5865f2); // blue = running
    expect(embed.fields).toBeDefined();
  });

  it("renders completed state in green", () => {
    const state = createDashboardState({ title: "Done", model: "m" });
    state.status = "completed";

    const payload = renderDashboardEmbed(state);
    expect(payload.embeds![0].color).toBe(0x57f287);
  });

  it("shows recent activity", () => {
    const state = createDashboardState({ title: "t", model: "m" });
    dashboardCompleteCurrentTool(state, "bash", "bash `bun test`");
    dashboardCompleteCurrentTool(state, "edit", "edit src/app.ts");

    const payload = renderDashboardEmbed(state);
    const desc = payload.embeds![0].description!;
    expect(desc).toContain("Recent activity");
    expect(desc).toContain("edit src/app.ts");
    expect(desc).toContain("bash `bun test`");
  });

  it("respects embed size limits", () => {
    const state = createDashboardState({ title: "t", model: "m" });
    const payload = renderDashboardEmbed(state);
    const embed = payload.embeds![0];

    expect(embed.title!.length).toBeLessThanOrEqual(256);
    expect(embed.description!.length).toBeLessThanOrEqual(4096);
  });
});

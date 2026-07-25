import { describe, expect, it } from "bun:test";
import { humanizeToolName, parseMcpToolName } from "./tool-icon";

describe("parseMcpToolName", () => {
  it("parses the Claude Code namespaced form", () => {
    expect(parseMcpToolName("mcp__almirant__get_ideation_context")).toMatchObject({
      serverRaw: "almirant",
      serverLabel: "Almirant",
      action: "get_ideation_context",
      actionLabel: "Ideation context",
    });
  });

  it("parses the OpenCode flattened form for managed servers", () => {
    expect(parseMcpToolName("scraper_fetch_document")).toMatchObject({
      serverRaw: "scraper",
      serverLabel: "Scraper",
      action: "fetch_document",
      actionLabel: "Fetch document",
    });
  });

  it("parses the OpenCode flattened form for the almirant server", () => {
    expect(parseMcpToolName("almirant_submit_agent_output")).toMatchObject({
      serverRaw: "almirant",
      serverLabel: "Almirant",
      action: "submit_agent_output",
      actionLabel: "Submit agent output",
    });
  });

  it("does not treat built-in snake_case-free tools as MCP calls", () => {
    expect(parseMcpToolName("Read")).toBeNull();
    expect(parseMcpToolName("TodoWrite")).toBeNull();
  });

  it("does not treat unknown snake_case tools as MCP calls", () => {
    expect(parseMcpToolName("some_random_local_tool")).toBeNull();
  });
});

describe("humanizeToolName", () => {
  it("keeps built-in tool names untouched", () => {
    expect(humanizeToolName("Read")).toBe("Read");
    expect(humanizeToolName("Edit")).toBe("Edit");
  });

  it("uses the MCP action label for namespaced tools", () => {
    expect(humanizeToolName("mcp__almirant__create_task")).toBe("Create task");
  });

  it("uses the MCP action label for OpenCode flattened tools", () => {
    expect(humanizeToolName("scraper_fetch_document")).toBe("Fetch document");
  });

  it("humanizes unknown snake_case tools with sentence case", () => {
    expect(humanizeToolName("some_random_local_tool")).toBe(
      "Some random local tool",
    );
  });

  it("humanizes unknown kebab-case tools with sentence case", () => {
    expect(humanizeToolName("run-browser-check")).toBe("Run browser check");
  });

  it("leaves already human-readable names alone", () => {
    expect(humanizeToolName("Fetch document")).toBe("Fetch document");
  });
});

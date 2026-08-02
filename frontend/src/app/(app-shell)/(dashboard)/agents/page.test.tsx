import { describe, expect, it, mock } from "bun:test";
import { render, screen } from "@testing-library/react";

mock.module("motion/react", () => ({
  motion: {
    div: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
  },
}));

mock.module(
  "@/domains/scheduled-agents/presentation/containers/scheduled-agents-container",
  () => ({ ScheduledAgentsContainer: () => <div>Agents content</div> }),
);
mock.module(
  "@/domains/scheduled-agents/presentation/containers/agent-tooling-container",
  () => ({
    AgentMcpServersContainer: () => <div>MCP content</div>,
    AgentPluginsContainer: () => <div>Plugins content</div>,
  }),
);
mock.module(
  "@/domains/skills/presentation/containers/skills-container",
  () => ({ SkillsContainer: () => <div>Skills content</div> }),
);
mock.module(
  "@/domains/sessions/presentation/containers/sessions-page-container",
  () => ({ SessionsPageContainer: () => <div>Sessions content</div> }),
);
mock.module(
  "@/domains/user-storage/presentation/containers/user-storage-container",
  () => ({ UserStorageContainer: () => <div>Storage content</div> }),
);

Object.defineProperty(globalThis, "requestAnimationFrame", {
  configurable: true,
  value: (() => 1) as typeof requestAnimationFrame,
});
Object.defineProperty(globalThis, "cancelAnimationFrame", {
  configurable: true,
  value: (() => undefined) as typeof cancelAnimationFrame,
});

const { default: AgentsPage, AGENT_TABS } = await import("./page");

describe("AgentsPage tabs", () => {
  it("offers user storage alongside the agent tooling tabs", () => {
    expect(AGENT_TABS.map(({ value }) => value)).toContain("storage");

    render(<AgentsPage />);

    expect(
      screen.getByRole("button", { name: "Storage" }),
    ).toBeInTheDocument();
  });

  it("offers MCP and Plugins tabs for the Agents v2 tooling catalog", () => {
    expect(AGENT_TABS.map(({ value }) => value)).toEqual(
      expect.arrayContaining(["mcp", "plugins"]),
    );

    render(<AgentsPage />);

    expect(screen.getByRole("button", { name: "MCP" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Plugins" })).toBeInTheDocument();
  });
});

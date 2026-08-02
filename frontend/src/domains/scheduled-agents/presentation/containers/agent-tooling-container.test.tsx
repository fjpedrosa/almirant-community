import { beforeEach, describe, expect, it, mock } from "bun:test";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

if (!(globalThis as { NodeFilter?: unknown }).NodeFilter) {
  (globalThis as { NodeFilter?: unknown }).NodeFilter = {
    SHOW_ELEMENT: 1,
    FILTER_ACCEPT: 1,
    FILTER_REJECT: 2,
    FILTER_SKIP: 3,
  };
}
for (const constructorName of [
  "HTMLElement",
  "HTMLInputElement",
  "HTMLSelectElement",
  "HTMLTextAreaElement",
] as const) {
  const constructors = globalThis as unknown as Record<string, unknown>;
  if (!constructors[constructorName]) {
    constructors[constructorName] = (window as unknown as Record<string, unknown>)[
      constructorName
    ];
  }
}

const mutations = {
  createTemplate: mock(() => undefined),
  testMcp: mock(() => undefined),
  install: mock(() => undefined),
  upload: mock(() => undefined),
};

const mutation = (mutate = mock(() => undefined)) => ({
  mutate,
  isPending: false,
  error: null,
});

mock.module("../../application/hooks/use-agent-tooling", () => ({
  useAgentMcpServers: () => ({ data: [], isLoading: false }),
  useMcpConnectorTemplates: () => ({
    data: [
      {
        key: "github",
        name: "GitHub",
        description: "GitHub tools",
        url: "https://api.githubcopilot.com/mcp/",
        runnerServerName: "github",
        authType: "bearer",
        authHeaderName: "Authorization",
        secretLabel: "GitHub personal access token",
        secretRequired: true,
        docsUrl: "https://github.com/github/github-mcp-server",
        defaultConfiguration: { readOnly: true, toolsets: ["repos"] },
      },
    ],
  }),
  useCreateAgentMcpServer: () => mutation(),
  useCreateMcpServerFromTemplate: () => mutation(mutations.createTemplate),
  useUpdateAgentMcpServer: () => mutation(),
  useDeleteAgentMcpServer: () => mutation(),
  useTestAgentMcpServer: () => mutation(mutations.testMcp),
  useAgentPlugins: () => ({ data: [], isLoading: false }),
  usePluginMarketplaces: () => ({
    data: [
      {
        id: "market-1",
        name: "Claude Plugins Official",
        slug: "claude-plugins-official",
        provider: "claude-code",
        source: "anthropics/claude-plugins-official",
        sourceType: "github",
        catalog: {
          name: "claude-plugins-official",
          plugins: [
            {
              externalId: "security-review",
              name: "security-review",
              description: "Security review workflow",
              version: "1.0.0",
              category: "quality",
              tags: [],
            },
          ],
        },
        enabled: true,
        isBuiltIn: true,
        lastSyncedAt: null,
        createdAt: "2026-07-10T10:00:00.000Z",
        updatedAt: "2026-07-10T10:00:00.000Z",
      },
    ],
    isLoading: false,
  }),
  usePluginPackages: () => ({ data: [], isLoading: false }),
  useCreateAgentPlugin: () => mutation(),
  useUpdateAgentPlugin: () => mutation(),
  useDeleteAgentPlugin: () => mutation(),
  useAddPluginMarketplace: () => mutation(),
  useSyncPluginMarketplace: () => mutation(),
  useDeletePluginMarketplace: () => mutation(),
  useInstallMarketplacePlugin: () => mutation(mutations.install),
  useUploadPluginPackage: () => mutation(mutations.upload),
}));

const {
  AgentMcpServersContainer,
  AgentPluginsContainer,
} = await import("./agent-tooling-container");

beforeEach(() => {
  for (const fn of Object.values(mutations)) fn.mockClear();
});

describe("agent tooling containers", () => {
  it("connects a verified MCP template with an encrypted secret", async () => {
    render(<AgentMcpServersContainer />);

    await userEvent.click(
      screen.getByRole("button", { name: "Connect GitHub" }),
    );
    await userEvent.type(
      screen.getByLabelText("GitHub personal access token"),
      "github_pat_private",
    );
    await userEvent.click(screen.getByRole("button", { name: "Save" }));

    expect(mutations.createTemplate).toHaveBeenCalledWith(
      expect.objectContaining({
        templateKey: "github",
        secret: "github_pat_private",
        configuration: { readOnly: true, toolsets: ["repos"] },
      }),
      expect.any(Object),
    );
  });

  it("installs a marketplace plugin and uploads a private ZIP", async () => {
    render(<AgentPluginsContainer />);

    await userEvent.click(screen.getByRole("button", { name: "Install" }));
    expect(mutations.install).toHaveBeenCalledWith({
      marketplaceId: "market-1",
      externalId: "security-review",
    });

    await userEvent.click(screen.getByRole("button", { name: "Upload ZIP" }));
    const file = new File(["zip"], "private-plugin.zip", {
      type: "application/zip",
    });
    await userEvent.upload(screen.getByLabelText("Plugin ZIP"), file);
    await userEvent.click(screen.getByRole("button", { name: "Upload plugin" }));

    expect(mutations.upload).toHaveBeenCalledWith(
      expect.objectContaining({ file }),
      expect.any(Object),
    );
  });
});

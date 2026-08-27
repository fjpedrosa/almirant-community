import { describe, expect, it, beforeAll, mock } from "bun:test";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Window } from "happy-dom";
import { useForm, useWatch } from "react-hook-form";

// This drawer has no i18n coverage today except for the 'once' strings
// introduced alongside this test — see messages/{en,es}.json under
// "scheduledAgents.once". Returning the raw key (with any params inlined)
// keeps assertions readable without a real NextIntlClientProvider.
mock.module("next-intl", () => ({
  useTranslations: () =>
    (key: string, values?: Record<string, string | number>) => {
      if (!values) return key;
      return `${key}:${JSON.stringify(values)}`;
    },
}));

const { AgentFormDrawer } = await import("./agent-form-drawer");
import type {
  AgentFormDrawerProps,
  AgentMcpServer,
  AgentPlugin,
} from "../../domain/types";

// happy-dom classes for polyfilling APIs Radix + the slash textarea need.
const happyWindow = new Window();

beforeAll(() => {
  // The slash-autocomplete textarea and Radix animations schedule work on the
  // next frame; happy-dom does not expose these globally.
  if (typeof globalThis.requestAnimationFrame !== "function") {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (globalThis as any).requestAnimationFrame = (cb: (time: number) => void) =>
      setTimeout(() => cb(Date.now()), 0);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (globalThis as any).cancelAnimationFrame = (id: number) =>
      clearTimeout(id as unknown as ReturnType<typeof setTimeout>);
  }
  // Radix focus-scope walks the DOM with a TreeWalker filtered by NodeFilter and
  // narrows on concrete HTML element constructors; expose the ones it touches.
  const domGlobals = [
    "NodeFilter",
    "MouseEvent",
    "CustomEvent",
    "KeyboardEvent",
    "PointerEvent",
    "HTMLInputElement",
    "HTMLTextAreaElement",
    "HTMLSelectElement",
    "HTMLButtonElement",
    "HTMLAnchorElement",
    "DocumentFragment",
    "Range",
    "DOMRect",
    "Text",
    "Comment",
  ] as const;
  for (const name of domGlobals) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    if (typeof (globalThis as any)[name] === "undefined") {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (globalThis as any)[name] = (happyWindow as any)[name];
    }
  }
  if (!Element.prototype.hasPointerCapture) {
    Element.prototype.hasPointerCapture = () => false;
  }
  if (!Element.prototype.setPointerCapture) {
    Element.prototype.setPointerCapture = () => {};
  }
  if (!Element.prototype.releasePointerCapture) {
    Element.prototype.releasePointerCapture = () => {};
  }
  if (!Element.prototype.scrollIntoView) {
    Element.prototype.scrollIntoView = () => {};
  }
  // Radix Select/Popover size hooks rely on these observers.
  if (typeof globalThis.ResizeObserver === "undefined") {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (globalThis as any).ResizeObserver = class {
      observe() {}
      unobserve() {}
      disconnect() {}
    };
  }
  if (typeof globalThis.IntersectionObserver === "undefined") {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (globalThis as any).IntersectionObserver = class {
      observe() {}
      unobserve() {}
      disconnect() {}
      takeRecords() {
        return [];
      }
    };
  }
});

const noop = () => {};

const skills = [
  { slug: "nightly-fix", name: "Nightly Fix", description: "Fixes things" },
];

const INLINE_PLACEHOLDER = "Type / to invoke a skill, or write instructions...";
const MODAL_PLACEHOLDER = /expand the prompt editor/i;

const Harness = ({
  plugins = [],
  mcpServers = [],
  selectedPluginIds = [],
  selectedMcpServerIds = [],
  scheduleType = "manual",
  onceRunAtLocal = "",
  lastRunAt = null,
  onceRunAtPastWarning = false,
  isEditing = true,
  provider = "claude-code",
  codingAgent = "claude-code",
  aiProvider = "",
  aiModel = "",
  reasoningLevel = undefined,
  needsBrowser = false,
  availableProviders = [],
  availableModels = [],
  availableReasoningLevels = [],
}: {
  plugins?: AgentPlugin[];
  mcpServers?: AgentMcpServer[];
  selectedPluginIds?: string[];
  selectedMcpServerIds?: string[];
  scheduleType?: "manual" | "time_window" | "cron" | "once";
  onceRunAtLocal?: string;
  lastRunAt?: string | null;
  onceRunAtPastWarning?: boolean;
  isEditing?: boolean;
  provider?: string | null;
  codingAgent?: string | null;
  aiProvider?: string | null;
  aiModel?: string | null;
  reasoningLevel?: string | null;
  needsBrowser?: boolean;
  availableProviders?: AgentFormDrawerProps["availableProviders"];
  availableModels?: AgentFormDrawerProps["availableModels"];
  availableReasoningLevels?: AgentFormDrawerProps["availableReasoningLevels"];
} = {}) => {
  const form = useForm({
    defaultValues: {
      name: "Agent",
      description: "",
      projectId: "",
      prompt: "",
      provider,
      codingAgent,
      aiProvider,
      aiModel,
      reasoningLevel,
      needsBrowser,
      scheduleType,
      onceRunAtLocal,
      trigger: "scheduled",
      selectedPluginIds,
      selectedMcpServerIds,
    },
  });
  // Mirrors how ScheduledAgentsContainer wires useAgentFormDrawer's watched
  // selection back into AgentFormDrawerProps, so a toggle click updates the
  // rendered checked state instead of staying frozen at the initial prop.
  const watchedSelectedPluginIds =
    (useWatch({ control: form.control, name: "selectedPluginIds" }) as string[] | undefined) ??
    selectedPluginIds;
  const watchedSelectedMcpServerIds =
    (useWatch({ control: form.control, name: "selectedMcpServerIds" }) as string[] | undefined) ??
    selectedMcpServerIds;

  const props: AgentFormDrawerProps = {
    open: true,
    onOpenChange: noop,
    isEditing,
    isPending: false,
    form,
    onSubmit: async () => {},
    skills,
    userSkills: [],
    plugins,
    mcpServers,
    selectedPluginIds: watchedSelectedPluginIds,
    selectedMcpServerIds: watchedSelectedMcpServerIds,
    projects: [],
    scheduleType,
    trigger: "scheduled",
    availableProviders,
    availableModels,
    availableReasoningLevels,
    agentKind: "repository",
    automationTargetKind: "builtin",
    automationSkillSlug: null,
    builtinAutomationId: "backlog-drain",
    automationProjectIds: [],
    backlogDrainEnabled: false,
    backlogDrainProjectIds: [],
    backlogDrainWorkItems: [],
    isLoadingBacklogDrainWorkItems: false,
    backlogDrainPreview: null,
    isLoadingBacklogDrainPreview: false,
    webhookProposal: null,
    isLoadingWebhookProposal: false,
    lastRunAt,
    onceRunAtPastWarning,
  };

  return <AgentFormDrawer {...props} />;
};

describe("AgentFormDrawer prompt modal", () => {
  it("renders the inline Prompt field", () => {
    render(<Harness />);
    expect(screen.getByText("Prompt")).toBeInTheDocument();
    // The expanded editor is not present until the Expand button is clicked.
    expect(screen.queryByPlaceholderText(MODAL_PLACEHOLDER)).toBeNull();

  });

  it("opens a modal editor and keeps it in sync with the prompt field", async () => {
    const user = userEvent.setup();
    render(<Harness />);

    await user.click(
      screen.getByRole("button", { name: /expand prompt editor/i }),
    );

    const modalEditor = (await screen.findByPlaceholderText(
      MODAL_PLACEHOLDER,
    )) as HTMLTextAreaElement;
    expect(modalEditor).toBeInTheDocument();

    await user.type(modalEditor, "hello from modal");

    // Typing in the modal syncs the shared RHF `prompt` field, so the inline
    // editor reflects the same value.
    await waitFor(() => {
      const inline = screen.getByPlaceholderText(
        INLINE_PLACEHOLDER,
      ) as HTMLTextAreaElement;
      expect(inline.value).toBe("hello from modal");
    });
  });
});

const testPlugin: AgentPlugin = {
  id: "11111111-1111-1111-1111-111111111111",
  workspaceId: "workspace-1",
  name: "Repo audit",
  slug: "repo-audit",
  description: "Runs a repository audit before touching code.",
  instructions: "Audit the repository first.",
  ownerUserId: "user-1",
  visibility: "user",
  provider: "portable",
  sourceType: "instructions",
  marketplaceId: null,
  externalId: null,
  version: null,
  checksumSha256: null,
  manifest: null,
  enabled: true,
  archivedAt: null,
  createdByUserId: "user-1",
  createdAt: "2026-07-10T10:00:00.000Z",
  updatedAt: "2026-07-10T10:00:00.000Z",
};

const testMcpServer: AgentMcpServer = {
  id: "22222222-2222-2222-2222-222222222222",
  workspaceId: "workspace-1",
  projectId: null,
  ownerUserId: "user-1",
  name: "Z Combinator search",
  slug: "z-combinator",
  description: "Search Z Combinator listings.",
  url: "https://mcp.example.com/mcp",
  transport: "remote",
  visibility: "user",
  authType: "none",
  authHeaderName: null,
  templateKey: null,
  configuration: {},
  hasSecret: false,
  enabled: true,
  version: 1,
  archivedAt: null,
  createdByUserId: "user-1",
  createdAt: "2026-07-10T10:00:00.000Z",
  updatedAt: "2026-07-10T10:00:00.000Z",
};

describe("AgentFormDrawer MCP servers and plugins selection", () => {
  it("renders raw future, codex-cli, and null runtime values as retained edit data", () => {
    const futureView = render(
      <Harness
        provider="future-lane"
        codingAgent="future-agent"
        aiProvider="future-provider"
        aiModel="Future/Model@1"
        reasoningLevel="ULTRA"
      />,
    );

    expect(screen.getByText("Retained legacy provider: future-lane")).toBeInTheDocument();
    expect(screen.getByText("Retained coding agent: future-agent")).toBeInTheDocument();
    expect(screen.getByText("Retained AI provider: future-provider")).toBeInTheDocument();
    expect(screen.getByText("Retained model: Future/Model@1")).toBeInTheDocument();
    expect(screen.getByText("Retained reasoning level: ULTRA")).toBeInTheDocument();

    futureView.unmount();
    const codexView = render(
      <Harness
        provider="codex"
        codingAgent="codex-cli"
        aiProvider="openai"
        aiModel="gpt-5.5"
      />,
    );
    expect(screen.getByText("Retained coding agent: codex-cli")).toBeInTheDocument();

    codexView.unmount();
    render(
      <Harness
        provider={null}
        codingAgent={null}
        aiProvider={null}
        aiModel={null}
      />,
    );
    expect(screen.getByText("Retained default legacy provider")).toBeInTheDocument();
    expect(screen.getByText("Retained default coding agent")).toBeInTheDocument();
    expect(screen.getByText("Retained default AI provider")).toBeInTheDocument();
    expect(screen.getByText("Retained default model")).toBeInTheDocument();
  });

  it("renders only the admitted Pi tuple and disables unsupported capabilities with typed reasons", () => {
    render(
      <Harness
        provider="zipu"
        codingAgent="pi"
        aiProvider="zai"
        aiModel="glm-5.3"
        availableProviders={["zai"]}
        availableModels={[{ value: "glm-5.3", label: "GLM-5.3" }]}
        plugins={[testPlugin]}
        mcpServers={[testMcpServer]}
      />,
    );

    expect(screen.queryByText(/Retained (coding agent|AI provider|model)/)).toBeNull();
    expect(screen.getByText("Pi coding agent.")).toBeInTheDocument();
    expect(screen.getByText(/z\.ai.*inferred from coding agent/i)).toBeInTheDocument();
    expect(screen.getAllByText("GLM-5.3").length).toBeGreaterThan(0);
    expect(screen.getByRole("switch", { name: "Browser / Playwright" })).toBeDisabled();
    expect(screen.getByRole("checkbox", { name: /Repo audit/i })).toBeDisabled();
    expect(screen.getByRole("checkbox", { name: /Z Combinator search/i })).toBeDisabled();
    expect(screen.getByText(/PI_CAPABILITY_BROWSER_DISABLED/)).toBeInTheDocument();
    expect(screen.getByText(/PI_CAPABILITY_EXTENSIONS_DISABLED/)).toBeInTheDocument();
    expect(screen.getByText(/PI_CAPABILITY_MCP_DISABLED/)).toBeInTheDocument();
  });

  it("no longer renders the legacy raw MCP servers JSON textarea", () => {
    render(<Harness />);
    expect(screen.queryByText("Additional MCP servers")).toBeNull();
  });

  it("shows empty-state hints when the tooling catalog has nothing yet", () => {
    render(<Harness />);
    expect(
      screen.getByText("No plugins yet. Add one from the Plugins tab, then select it here."),
    ).toBeInTheDocument();
    expect(
      screen.getByText("No MCP servers yet. Add one from the MCP tab, including its secret if required."),
    ).toBeInTheDocument();
  });

  it("lists catalog plugins and MCP servers with a selected count", () => {
    render(
      <Harness
        plugins={[testPlugin]}
        mcpServers={[testMcpServer]}
        selectedPluginIds={[testPlugin.id]}
      />,
    );

    expect(screen.getByText("Repo audit")).toBeInTheDocument();
    expect(screen.getByText("Z Combinator search")).toBeInTheDocument();
    expect(screen.getByText("1 selected")).toBeInTheDocument();
    expect(screen.getByText("0 selected")).toBeInTheDocument();
  });

  it("toggles an MCP server selection on and off", () => {
    render(<Harness mcpServers={[testMcpServer]} />);
    const checkbox = screen.getByRole("checkbox", {
      name: /Z Combinator search/i,
    });
    expect(checkbox.getAttribute("aria-checked")).toBe("false");

    fireEvent.click(checkbox);
    expect(checkbox.getAttribute("aria-checked")).toBe("true");
    expect(screen.getByText("1 selected")).toBeInTheDocument();

    fireEvent.click(checkbox);
    expect(checkbox.getAttribute("aria-checked")).toBe("false");
  });

  it("toggles a plugin selection on and off", () => {
    render(<Harness plugins={[testPlugin]} />);
    const checkbox = screen.getByRole("checkbox", { name: /Repo audit/i });
    expect(checkbox.getAttribute("aria-checked")).toBe("false");

    fireEvent.click(checkbox);
    expect(checkbox.getAttribute("aria-checked")).toBe("true");

    fireEvent.click(checkbox);
    expect(checkbox.getAttribute("aria-checked")).toBe("false");
  });
});

describe("AgentFormDrawer once schedule", () => {
  it("shows the 'Run at' picker when the schedule type is 'once'", async () => {
    const user = userEvent.setup();
    render(<Harness scheduleType="once" />);

    expect(screen.getByText("once.runAtLabel")).toBeInTheDocument();
    expect(screen.getByText("once.runAtDescription")).toBeInTheDocument();
    // No lastRunAt / past-date warning by default.
    expect(screen.queryByText("once.rearmHint")).not.toBeInTheDocument();
    expect(screen.queryByText("once.pastWarning")).not.toBeInTheDocument();

    await user.type(screen.getByLabelText("once.runAtLabel"), "2026-08-15T14:30");
    expect(screen.getByLabelText("once.runAtLabel")).toHaveValue("2026-08-15T14:30");
  });

  it("shows a NON-blocking warning when the picked date/time has already passed", () => {
    render(<Harness scheduleType="once" onceRunAtPastWarning />);
    expect(screen.getByText("once.pastWarning")).toBeInTheDocument();
  });

  it("shows the re-arm hint when editing an already-executed 'once' agent (lastRunAt is set)", () => {
    render(<Harness scheduleType="once" lastRunAt="2026-04-10T09:00:05.000Z" />);
    expect(screen.getByText("once.rearmHint")).toBeInTheDocument();
  });

  it("does NOT show the re-arm hint when the 'once' agent has not run yet", () => {
    render(<Harness scheduleType="once" lastRunAt={null} />);
    expect(screen.queryByText("once.rearmHint")).not.toBeInTheDocument();
  });
});

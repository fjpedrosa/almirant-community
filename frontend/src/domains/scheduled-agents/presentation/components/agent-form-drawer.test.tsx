import { describe, expect, it, beforeAll } from "bun:test";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Window } from "happy-dom";
import { useForm, useWatch } from "react-hook-form";
import { AgentFormDrawer } from "./agent-form-drawer";
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
}: {
  plugins?: AgentPlugin[];
  mcpServers?: AgentMcpServer[];
  selectedPluginIds?: string[];
  selectedMcpServerIds?: string[];
} = {}) => {
  const form = useForm({
    defaultValues: {
      name: "Agent",
      description: "",
      prompt: "",
      codingAgent: "claude-code",
      aiProvider: "",
      aiModel: "",
      reasoningLevel: undefined,
      scheduleType: "manual",
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
    isEditing: true,
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
    scheduleType: "manual",
    trigger: "scheduled",
    availableProviders: [],
    availableModels: [],
    availableReasoningLevels: [],
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

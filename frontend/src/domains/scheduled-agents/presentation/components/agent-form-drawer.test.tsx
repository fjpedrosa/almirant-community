import { describe, expect, it, beforeAll } from "bun:test";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Window } from "happy-dom";
import { useForm } from "react-hook-form";
import { AgentFormDrawer } from "./agent-form-drawer";
import type { AgentFormDrawerProps } from "../../domain/types";

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

const Harness = () => {
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
    },
  });

  const props: AgentFormDrawerProps = {
    open: true,
    onOpenChange: noop,
    isEditing: true,
    isPending: false,
    form,
    onSubmit: async () => {},
    skills,
    userSkills: [],
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

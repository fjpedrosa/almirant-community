import { describe, expect, it, mock, beforeAll } from "bun:test";
import { render, screen } from "@testing-library/react";
import { Window } from "happy-dom";

// Get DOM classes from happy-dom
const happyWindow = new Window();

// Polyfill DOM APIs for happy-dom (Radix requires these)
beforeAll(() => {
  if (!Element.prototype.hasPointerCapture) {
    Element.prototype.hasPointerCapture = () => false;
  }
  if (!Element.prototype.setPointerCapture) {
    Element.prototype.setPointerCapture = () => {};
  }
  if (!Element.prototype.releasePointerCapture) {
    Element.prototype.releasePointerCapture = () => {};
  }
  // Expose MouseEvent and CustomEvent from happy-dom
  if (typeof globalThis.MouseEvent === "undefined") {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (globalThis as any).MouseEvent = happyWindow.MouseEvent;
  }
  if (typeof globalThis.CustomEvent === "undefined") {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (globalThis as any).CustomEvent = happyWindow.CustomEvent;
  }
});

// Capture the outside event handlers passed to SheetContent
let capturedHandlers: {
  onPointerDownOutside?: (event: Event) => void;
  onFocusOutside?: (event: Event) => void;
  onInteractOutside?: (event: Event) => void;
} = {};

// Mock the Sheet components to capture handlers while avoiding Radix focus-scope issues
mock.module("@/components/ui/sheet", () => ({
  Sheet: ({
    children,
    open,
  }: React.PropsWithChildren<{ open: boolean; modal?: boolean }>) =>
    open ? <div data-testid="sheet-root">{children}</div> : null,
  SheetContent: ({
    children,
    onPointerDownOutside,
    onFocusOutside,
    onInteractOutside,
  }: React.PropsWithChildren<{
    side?: string;
    overlayClassName?: string;
    className?: string;
    onPointerDownOutside?: (event: Event) => void;
    onFocusOutside?: (event: Event) => void;
    onInteractOutside?: (event: Event) => void;
  }>) => {
    capturedHandlers = { onPointerDownOutside, onFocusOutside, onInteractOutside };
    return <div data-testid="sheet-content">{children}</div>;
  },
  SheetHeader: ({ children }: React.PropsWithChildren) => (
    <div data-testid="sheet-header">{children}</div>
  ),
  SheetTitle: ({ children }: React.PropsWithChildren) => (
    <h2 data-testid="sheet-title">{children}</h2>
  ),
  SheetDescription: ({ children }: React.PropsWithChildren) => (
    <p data-testid="sheet-description">{children}</p>
  ),
}));

mock.module(
  "@/domains/agents/presentation/components/agent-job-status-badge",
  () => ({
    AgentJobStatusBadge: ({ status }: { status: string }) => (
      <span data-testid="agent-job-status-badge">{status}</span>
    ),
  }),
);

const { SessionDetailSheet } = await import("./session-detail-sheet");

/**
 * Helper to create a mock Radix outside event.
 *
 * Radix UI >= 1.1 fires CustomEvents for outside interactions where:
 * - event.target may be null or the dialog content itself
 * - The actual clicked element is in event.detail.originalEvent.target
 *
 * This is the root cause of the bug being fixed.
 */
const createRadixOutsideEvent = (
  targetElement: Element | null,
  options: { targetOnEvent?: Element | null } = {},
): CustomEvent<{ originalEvent: Event }> => {
  const originalEvent = new MouseEvent("pointerdown", { bubbles: true });
  Object.defineProperty(originalEvent, "target", {
    value: targetElement,
    writable: false,
  });

  const radixEvent = new CustomEvent("pointerdownoutside", {
    bubbles: false,
    cancelable: true,
    detail: { originalEvent },
  });

  // Simulate Radix behavior: event.target is NOT the clicked element
  Object.defineProperty(radixEvent, "target", {
    value: options.targetOnEvent ?? null,
    writable: false,
  });

  return radixEvent;
};

/**
 * Helper to create a standard DOM event (pre-Radix 1.1 behavior or when
 * event.target IS the actual clicked element)
 */
const createStandardEvent = (targetElement: Element): Event => {
  const event = new MouseEvent("pointerdown", {
    bubbles: true,
    cancelable: true,
  });
  Object.defineProperty(event, "target", {
    value: targetElement,
    writable: false,
  });
  return event;
};

describe("SessionDetailSheet", () => {
  it("renders with title, status badge, and live indicator", () => {
    capturedHandlers = {};

    render(
      <SessionDetailSheet
        isOpen
        onOpenChange={() => {}}
        title="Test Session"
        status="running"
        isLive
      >
        <div>Session body content</div>
      </SessionDetailSheet>,
    );

    expect(screen.getByText("Test Session")).toBeInTheDocument();
    expect(screen.getByText("Session body content")).toBeInTheDocument();
    expect(screen.getByTestId("agent-job-status-badge")).toHaveTextContent(
      "running",
    );
    expect(screen.getByText("Live")).toBeInTheDocument();
  });

  it("does not render when isOpen is false", () => {
    render(
      <SessionDetailSheet
        isOpen={false}
        onOpenChange={() => {}}
        title="Test Session"
        status={null}
        isLive={false}
      >
        <div>Session body content</div>
      </SessionDetailSheet>,
    );

    expect(screen.queryByText("Test Session")).not.toBeInTheDocument();
  });

  describe("outside event handling - standard event.target", () => {
    it("prevents default when clicking feedback widget trigger", () => {
      capturedHandlers = {};

      render(
        <SessionDetailSheet
          isOpen
          onOpenChange={() => {}}
          title="Test Session"
          status={null}
          isLive={false}
        >
          <div>Content</div>
        </SessionDetailSheet>,
      );

      const feedbackTrigger = document.createElement("button");
      feedbackTrigger.setAttribute("data-feedback-widget-trigger", "");
      document.body.appendChild(feedbackTrigger);

      const event = createStandardEvent(feedbackTrigger);
      const preventDefaultMock = mock(() => {});
      event.preventDefault = preventDefaultMock;

      capturedHandlers.onPointerDownOutside?.(event);

      expect(preventDefaultMock).toHaveBeenCalledTimes(1);

      feedbackTrigger.remove();
    });

    it("prevents default when clicking chat feedback trigger", () => {
      capturedHandlers = {};

      render(
        <SessionDetailSheet
          isOpen
          onOpenChange={() => {}}
          title="Test Session"
          status={null}
          isLive={false}
        >
          <div>Content</div>
        </SessionDetailSheet>,
      );

      const chatTrigger = document.createElement("button");
      chatTrigger.setAttribute("data-chat-feedback-trigger", "");
      document.body.appendChild(chatTrigger);

      const event = createStandardEvent(chatTrigger);
      const preventDefaultMock = mock(() => {});
      event.preventDefault = preventDefaultMock;

      capturedHandlers.onPointerDownOutside?.(event);

      expect(preventDefaultMock).toHaveBeenCalledTimes(1);

      chatTrigger.remove();
    });

    it("prevents default when clicking inside feedback widget content", () => {
      capturedHandlers = {};

      render(
        <SessionDetailSheet
          isOpen
          onOpenChange={() => {}}
          title="Test Session"
          status={null}
          isLive={false}
        >
          <div>Content</div>
        </SessionDetailSheet>,
      );

      const feedbackContent = document.createElement("div");
      feedbackContent.setAttribute("data-feedback-widget-content", "");
      const innerButton = document.createElement("button");
      feedbackContent.appendChild(innerButton);
      document.body.appendChild(feedbackContent);

      const event = createStandardEvent(innerButton);
      const preventDefaultMock = mock(() => {});
      event.preventDefault = preventDefaultMock;

      capturedHandlers.onPointerDownOutside?.(event);

      expect(preventDefaultMock).toHaveBeenCalledTimes(1);

      feedbackContent.remove();
    });

    it("prevents default when clicking inside chat feedback content", () => {
      capturedHandlers = {};

      render(
        <SessionDetailSheet
          isOpen
          onOpenChange={() => {}}
          title="Test Session"
          status={null}
          isLive={false}
        >
          <div>Content</div>
        </SessionDetailSheet>,
      );

      const chatContent = document.createElement("div");
      chatContent.setAttribute("data-chat-feedback-content", "");
      const innerButton = document.createElement("button");
      chatContent.appendChild(innerButton);
      document.body.appendChild(chatContent);

      const event = createStandardEvent(innerButton);
      const preventDefaultMock = mock(() => {});
      event.preventDefault = preventDefaultMock;

      capturedHandlers.onPointerDownOutside?.(event);

      expect(preventDefaultMock).toHaveBeenCalledTimes(1);

      chatContent.remove();
    });

    it("does NOT prevent default when clicking outside feedback elements", () => {
      capturedHandlers = {};

      render(
        <SessionDetailSheet
          isOpen
          onOpenChange={() => {}}
          title="Test Session"
          status={null}
          isLive={false}
        >
          <div>Content</div>
        </SessionDetailSheet>,
      );

      const otherButton = document.createElement("button");
      document.body.appendChild(otherButton);

      const event = createStandardEvent(otherButton);
      const preventDefaultMock = mock(() => {});
      event.preventDefault = preventDefaultMock;

      capturedHandlers.onPointerDownOutside?.(event);

      expect(preventDefaultMock).not.toHaveBeenCalled();

      otherButton.remove();
    });

    it("does NOT prevent default when clicking unrelated select content (outside feedback widget)", () => {
      capturedHandlers = {};

      render(
        <SessionDetailSheet
          isOpen
          onOpenChange={() => {}}
          title="Test Session"
          status={null}
          isLive={false}
        >
          <div>Content</div>
        </SessionDetailSheet>,
      );

      // Simulate an unrelated Select's portaled content (e.g., a status filter dropdown)
      const unrelatedSelectContent = document.createElement("div");
      unrelatedSelectContent.setAttribute("data-slot", "select-content");
      const selectItem = document.createElement("button");
      unrelatedSelectContent.appendChild(selectItem);
      document.body.appendChild(unrelatedSelectContent);

      const event = createStandardEvent(selectItem);
      const preventDefaultMock = mock(() => {});
      event.preventDefault = preventDefaultMock;

      capturedHandlers.onPointerDownOutside?.(event);

      // Should NOT prevent default - the panel should close for unrelated selects
      expect(preventDefaultMock).not.toHaveBeenCalled();

      unrelatedSelectContent.remove();
    });
  });

  describe("outside event handling - Radix CustomEvent with detail.originalEvent.target", () => {
    /**
     * THIS IS THE CRITICAL TEST CASE
     *
     * In Radix >= 1.1, outside events are CustomEvents where:
     * - event.target is null or the dialog content
     * - The actual clicked element is event.detail.originalEvent.target
     *
     * The bug was that the handler only checked event.target, which
     * was null, so the feedback guard never matched.
     */

    it("prevents default when event.target is null but originalEvent.target is feedback trigger", () => {
      capturedHandlers = {};

      render(
        <SessionDetailSheet
          isOpen
          onOpenChange={() => {}}
          title="Test Session"
          status={null}
          isLive={false}
        >
          <div>Content</div>
        </SessionDetailSheet>,
      );

      const feedbackTrigger = document.createElement("button");
      feedbackTrigger.setAttribute("data-feedback-widget-trigger", "");
      document.body.appendChild(feedbackTrigger);

      // Create Radix-style event: event.target is null, real target in detail
      const event = createRadixOutsideEvent(feedbackTrigger, {
        targetOnEvent: null,
      });
      const preventDefaultMock = mock(() => {});
      event.preventDefault = preventDefaultMock;

      capturedHandlers.onPointerDownOutside?.(event);

      // With the fix, this should prevent default because we now check
      // detail.originalEvent.target as a fallback
      expect(preventDefaultMock).toHaveBeenCalledTimes(1);

      feedbackTrigger.remove();
    });

    it("prevents default when event.target is null but originalEvent.target is chat feedback trigger", () => {
      capturedHandlers = {};

      render(
        <SessionDetailSheet
          isOpen
          onOpenChange={() => {}}
          title="Test Session"
          status={null}
          isLive={false}
        >
          <div>Content</div>
        </SessionDetailSheet>,
      );

      const chatTrigger = document.createElement("button");
      chatTrigger.setAttribute("data-chat-feedback-trigger", "");
      document.body.appendChild(chatTrigger);

      const event = createRadixOutsideEvent(chatTrigger, {
        targetOnEvent: null,
      });
      const preventDefaultMock = mock(() => {});
      event.preventDefault = preventDefaultMock;

      capturedHandlers.onPointerDownOutside?.(event);

      expect(preventDefaultMock).toHaveBeenCalledTimes(1);

      chatTrigger.remove();
    });

    it("does NOT prevent default when originalEvent.target is outside feedback elements", () => {
      capturedHandlers = {};

      render(
        <SessionDetailSheet
          isOpen
          onOpenChange={() => {}}
          title="Test Session"
          status={null}
          isLive={false}
        >
          <div>Content</div>
        </SessionDetailSheet>,
      );

      const otherButton = document.createElement("button");
      document.body.appendChild(otherButton);

      const event = createRadixOutsideEvent(otherButton, {
        targetOnEvent: null,
      });
      const preventDefaultMock = mock(() => {});
      event.preventDefault = preventDefaultMock;

      capturedHandlers.onPointerDownOutside?.(event);

      expect(preventDefaultMock).not.toHaveBeenCalled();

      otherButton.remove();
    });

    it("prevents default when originalEvent.target is nested inside feedback category content", () => {
      capturedHandlers = {};

      render(
        <SessionDetailSheet
          isOpen
          onOpenChange={() => {}}
          title="Test Session"
          status={null}
          isLive={false}
        >
          <div>Content</div>
        </SessionDetailSheet>,
      );

      // Simulate the portaled SelectContent with a nested SelectItem
      const categoryContent = document.createElement("div");
      categoryContent.setAttribute("data-feedback-category-content", "");
      const selectItem = document.createElement("button");
      categoryContent.appendChild(selectItem);
      document.body.appendChild(categoryContent);

      const event = createRadixOutsideEvent(selectItem, {
        targetOnEvent: null,
      });
      const preventDefaultMock = mock(() => {});
      event.preventDefault = preventDefaultMock;

      capturedHandlers.onPointerDownOutside?.(event);

      expect(preventDefaultMock).toHaveBeenCalledTimes(1);

      categoryContent.remove();
    });

    it("prevents default when originalEvent.target is the feedback category content element itself", () => {
      capturedHandlers = {};

      render(
        <SessionDetailSheet
          isOpen
          onOpenChange={() => {}}
          title="Test Session"
          status={null}
          isLive={false}
        >
          <div>Content</div>
        </SessionDetailSheet>,
      );

      // Simulate clicking directly on the portaled SelectContent container
      const categoryContent = document.createElement("div");
      categoryContent.setAttribute("data-feedback-category-content", "");
      document.body.appendChild(categoryContent);

      const event = createRadixOutsideEvent(categoryContent, {
        targetOnEvent: null,
      });
      const preventDefaultMock = mock(() => {});
      event.preventDefault = preventDefaultMock;

      capturedHandlers.onPointerDownOutside?.(event);

      expect(preventDefaultMock).toHaveBeenCalledTimes(1);

      categoryContent.remove();
    });
  });

  describe("all outside event types", () => {
    it("handles onFocusOutside correctly", () => {
      capturedHandlers = {};

      render(
        <SessionDetailSheet
          isOpen
          onOpenChange={() => {}}
          title="Test Session"
          status={null}
          isLive={false}
        >
          <div>Content</div>
        </SessionDetailSheet>,
      );

      const feedbackTrigger = document.createElement("button");
      feedbackTrigger.setAttribute("data-feedback-widget-trigger", "");
      document.body.appendChild(feedbackTrigger);

      const event = createRadixOutsideEvent(feedbackTrigger, {
        targetOnEvent: null,
      });
      const preventDefaultMock = mock(() => {});
      event.preventDefault = preventDefaultMock;

      capturedHandlers.onFocusOutside?.(event);

      expect(preventDefaultMock).toHaveBeenCalledTimes(1);

      feedbackTrigger.remove();
    });

    it("handles onInteractOutside correctly", () => {
      capturedHandlers = {};

      render(
        <SessionDetailSheet
          isOpen
          onOpenChange={() => {}}
          title="Test Session"
          status={null}
          isLive={false}
        >
          <div>Content</div>
        </SessionDetailSheet>,
      );

      const feedbackTrigger = document.createElement("button");
      feedbackTrigger.setAttribute("data-feedback-widget-trigger", "");
      document.body.appendChild(feedbackTrigger);

      const event = createRadixOutsideEvent(feedbackTrigger, {
        targetOnEvent: null,
      });
      const preventDefaultMock = mock(() => {});
      event.preventDefault = preventDefaultMock;

      capturedHandlers.onInteractOutside?.(event);

      expect(preventDefaultMock).toHaveBeenCalledTimes(1);

      feedbackTrigger.remove();
    });
  });
});

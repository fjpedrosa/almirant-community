import { describe, it, expect, mock, beforeEach } from "bun:test";
import { render, act } from "@testing-library/react";

/**
 * Test state that controls the mocked mermaid module behavior.
 * These variables are accessed by the mock implementation.
 */
const testState = {
  initializeCallArgs: [] as Array<{ theme: string }>,
  renderResult: { svg: "<svg class='mermaid-svg'>mocked diagram</svg>" },
  shouldRenderFail: false,
  renderError: new Error("Mermaid render failed"),
  blockRender: false,
  releaseRenderFn: null as (() => void) | null,
  resolvedTheme: "light" as string | undefined,
};

// Mock mermaid module - uses testState for dynamic behavior
mock.module("mermaid", () => ({
  default: {
    initialize: (config: { theme: string }) => {
      testState.initializeCallArgs.push({ theme: config.theme });
    },
    render: async () => {
      // When blockRender is set, wait for release
      if (testState.blockRender) {
        await new Promise<void>((resolve) => {
          testState.releaseRenderFn = resolve;
        });
      }
      if (testState.shouldRenderFail) {
        throw testState.renderError;
      }
      return testState.renderResult;
    },
  },
}));

// Mock next-themes - uses testState for dynamic resolvedTheme
mock.module("next-themes", () => ({
  useTheme: () => ({
    resolvedTheme: testState.resolvedTheme,
    theme: testState.resolvedTheme,
    setTheme: () => {},
    themes: ["light", "dark"],
  }),
}));

// Import component after mocks are set up
import { MermaidRenderer } from "./mermaid-renderer";

/**
 * Helper to wait for the async effect to complete.
 * Uses a small delay to allow React's async state updates to settle.
 */
const waitForMermaid = async () => {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 50));
  });
};

describe("MermaidRenderer", () => {
  beforeEach(() => {
    // Reset all test state before each test
    testState.initializeCallArgs = [];
    testState.renderResult = { svg: "<svg class='mermaid-svg'>mocked diagram</svg>" };
    testState.shouldRenderFail = false;
    testState.renderError = new Error("Mermaid render failed");
    testState.blockRender = false;
    testState.releaseRenderFn = null;
    testState.resolvedTheme = "light";
  });

  it("renders loading skeleton initially", async () => {
    // Block the render to see the loading state
    testState.blockRender = true;

    // Render component but don't wait for mermaid to complete
    let cleanup: () => void = () => {};
    await act(async () => {
      const result = render(<MermaidRenderer chart="graph TD; A-->B;" />);
      cleanup = result.unmount;
    });

    // The skeleton should be visible while loading
    const divs = document.getElementsByTagName("div");
    let foundSkeleton = false;
    for (let i = 0; i < divs.length; i++) {
      const div = divs[i];
      if (div?.getAttribute("data-slot") === "skeleton") {
        foundSkeleton = true;
        break;
      }
    }
    expect(foundSkeleton).toBe(true);

    // Release the render to allow cleanup
    if (testState.releaseRenderFn) testState.releaseRenderFn();
    await waitForMermaid();
    cleanup();
  });

  it("renders Mermaid SVG content after loading", async () => {
    testState.renderResult = { svg: "<svg class='test-mermaid'>test diagram</svg>" };

    await act(async () => {
      render(<MermaidRenderer chart="graph TD; A-->B;" />);
    });

    await waitForMermaid();

    // Check that the SVG is inserted into the container by checking SVG elements
    const svgs = document.getElementsByTagName("svg");
    let foundSvg = false;
    for (let i = 0; i < svgs.length; i++) {
      const svg = svgs[i];
      if (svg?.getAttribute("class") === "test-mermaid") {
        foundSvg = true;
        break;
      }
    }
    expect(foundSvg).toBe(true);
  });

  it('uses "dark" theme when resolvedTheme is "dark"', async () => {
    testState.resolvedTheme = "dark";

    await act(async () => {
      render(<MermaidRenderer chart="graph TD; A-->B;" />);
    });

    await waitForMermaid();

    expect(testState.initializeCallArgs.length).toBeGreaterThan(0);
    const lastCall = testState.initializeCallArgs[testState.initializeCallArgs.length - 1];
    expect(lastCall.theme).toBe("dark");
  });

  it('uses "neutral" theme when resolvedTheme is "light"', async () => {
    testState.resolvedTheme = "light";

    await act(async () => {
      render(<MermaidRenderer chart="graph TD; A-->B;" />);
    });

    await waitForMermaid();

    expect(testState.initializeCallArgs.length).toBeGreaterThan(0);
    const lastCall = testState.initializeCallArgs[testState.initializeCallArgs.length - 1];
    expect(lastCall.theme).toBe("neutral");
  });

  it('falls back to "neutral" when resolvedTheme is undefined (SSR)', async () => {
    testState.resolvedTheme = undefined;

    await act(async () => {
      render(<MermaidRenderer chart="graph TD; A-->B;" />);
    });

    await waitForMermaid();

    expect(testState.initializeCallArgs.length).toBeGreaterThan(0);
    const lastCall = testState.initializeCallArgs[testState.initializeCallArgs.length - 1];
    expect(lastCall.theme).toBe("neutral");
  });

  it("shows error state with chart source when rendering fails", async () => {
    testState.shouldRenderFail = true;
    testState.renderError = new Error("Syntax error in diagram");

    const chartCode = "graph TD; INVALID";

    await act(async () => {
      render(<MermaidRenderer chart={chartCode} />);
    });

    await waitForMermaid();

    // Check error state text is displayed by checking paragraph elements
    const paragraphs = document.getElementsByTagName("p");
    let foundErrorHeading = false;
    let foundErrorMessage = false;
    for (let i = 0; i < paragraphs.length; i++) {
      const p = paragraphs[i];
      if (p?.textContent === "Diagram rendering failed") {
        foundErrorHeading = true;
      }
      if (p?.textContent === "Syntax error in diagram") {
        foundErrorMessage = true;
      }
    }
    expect(foundErrorHeading).toBe(true);
    expect(foundErrorMessage).toBe(true);

    // Check that the chart source code is displayed in the code element
    const codeElements = document.getElementsByTagName("code");
    let foundCode = false;
    for (let i = 0; i < codeElements.length; i++) {
      const code = codeElements[i];
      if (code?.textContent === chartCode) {
        foundCode = true;
        break;
      }
    }
    expect(foundCode).toBe(true);
  });

  it("clears SVG when chart prop changes", async () => {
    testState.renderResult = { svg: "<svg class='original-svg'>original</svg>" };

    let rerender: ReturnType<typeof render>["rerender"];

    await act(async () => {
      const result = render(<MermaidRenderer chart="graph TD; A-->B;" />);
      rerender = result.rerender;
    });

    await waitForMermaid();

    // Verify original SVG was inserted
    let svgs = document.getElementsByTagName("svg");
    let foundOriginal = false;
    for (let i = 0; i < svgs.length; i++) {
      if (svgs[i]?.getAttribute("class") === "original-svg") {
        foundOriginal = true;
        break;
      }
    }
    expect(foundOriginal).toBe(true);

    // Change the chart prop with a new render result
    testState.renderResult = { svg: "<svg class='updated-svg'>updated</svg>" };

    await act(async () => {
      rerender(<MermaidRenderer chart="graph TD; C-->D;" />);
    });

    await waitForMermaid();

    // The original SVG should be cleared and replaced
    svgs = document.getElementsByTagName("svg");
    let foundUpdated = false;
    foundOriginal = false;
    for (let i = 0; i < svgs.length; i++) {
      const svg = svgs[i];
      if (svg?.getAttribute("class") === "updated-svg") {
        foundUpdated = true;
      }
      if (svg?.getAttribute("class") === "original-svg") {
        foundOriginal = true;
      }
    }
    expect(foundUpdated).toBe(true);
    expect(foundOriginal).toBe(false);
  });
});

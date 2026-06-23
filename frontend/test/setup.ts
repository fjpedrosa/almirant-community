import { Window } from "happy-dom";
import "@testing-library/jest-dom";
import { afterEach, mock } from "bun:test";

// Global mock search params that tests can modify
const globalMockSearchParams = new URLSearchParams();

// Mock next/navigation globally for all tests
mock.module("next/navigation", () => ({
  useSearchParams: () => globalMockSearchParams,
  useParams: () => ({}),
  usePathname: () => "/",
  useRouter: () => ({
    push: () => {},
    replace: () => {},
    back: () => {},
    forward: () => {},
    refresh: () => {},
    prefetch: () => {},
  }),
  redirect: (url: string) => {
    throw new Error(`Redirect to ${url}`);
  },
}));

// Expose globally for tests to modify
(globalThis as any).__mockSearchParams = globalMockSearchParams;

// Minimal DOM shim for React Testing Library under `bun test`.
const window = new Window();

// happy-dom types are intentionally not identical to lib.dom.d.ts types.
// Keep this file permissive so `frontend` can use the standard TS DOM lib.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
globalThis.window = window as any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
globalThis.document = window.document as any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
globalThis.navigator = window.navigator as any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
globalThis.location = window.location as any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
globalThis.localStorage = window.localStorage as any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
globalThis.sessionStorage = window.sessionStorage as any;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
globalThis.HTMLElement = window.HTMLElement as any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
globalThis.Node = window.Node as any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
globalThis.Element = window.Element as any;

// Radix UI relies on these browser APIs for animations/focus management.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
globalThis.getComputedStyle = window.getComputedStyle.bind(window) as any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
globalThis.MutationObserver = window.MutationObserver as any;

// React 18+ expects this flag in some test environments.
// React 19 keeps the same convention.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
// Disable RTL's implicit auto-cleanup registration; we call cleanup manually below.
process.env.RTL_SKIP_AUTO_CLEANUP = "true";

afterEach(async () => {
  const { cleanup } = await import("@testing-library/react");
  cleanup();

  // Radix "scroll lock" can leave the body in a non-interactive state between tests.
  document.body.style.pointerEvents = "";
  document.body.removeAttribute("data-scroll-locked");
});

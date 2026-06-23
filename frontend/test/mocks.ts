import { mock } from "bun:test";

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

// Expose globally for test access
(globalThis as any).__mockSearchParams = globalMockSearchParams;

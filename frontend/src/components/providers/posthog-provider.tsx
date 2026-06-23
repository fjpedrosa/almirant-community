"use client";

import { type ReactNode, useEffect } from "react";
import { PostHogProvider as PHProvider } from "posthog-js/react";
import { initPostHog, posthog } from "@/lib/posthog";

/**
 * Use the env var directly (not isPostHogEnabled()) for the render branch.
 * NEXT_PUBLIC_ vars are inlined at build time, so this value is identical
 * on server and client — avoiding a hydration mismatch.
 * isPostHogEnabled() checks `typeof window`, which differs between SSR and
 * client and was the root cause of the reported hydration error.
 */
const posthogKey = process.env.NEXT_PUBLIC_POSTHOG_KEY;

export function PostHogProvider({ children }: { children: ReactNode }) {
  useEffect(() => {
    initPostHog();
  }, []);

  if (!posthogKey) {
    return <>{children}</>;
  }

  return <PHProvider client={posthog}>{children}</PHProvider>;
}

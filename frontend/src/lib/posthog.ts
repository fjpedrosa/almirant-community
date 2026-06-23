import posthog from "posthog-js";

const posthogKey = process.env.NEXT_PUBLIC_POSTHOG_KEY;

export const isPostHogEnabled = (): boolean =>
  typeof window !== "undefined" && !!posthogKey;

export const initPostHog = (): void => {
  if (!isPostHogEnabled() || !posthogKey) return;
  if (posthog.__loaded) return;

  posthog.init(posthogKey, {
    api_host: "/ingest",
    ui_host: "https://eu.posthog.com",
    person_profiles: "identified_only",
    capture_pageview: false,
    capture_pageleave: true,
    session_recording: {
      maskAllInputs: false,
      maskInputFn: (text, element) => {
        // Mask password fields, keep the rest visible
        if (element?.getAttribute("type") === "password") return "*".repeat(text.length);
        return text;
      },
    },
  });
};

export { posthog };

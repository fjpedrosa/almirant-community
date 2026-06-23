"use client";

import { usePathname } from "next/navigation";
import { useEffect } from "react";
import { isPostHogEnabled, posthog } from "@/lib/posthog";

export function PostHogPageview() {
  const pathname = usePathname();

  useEffect(() => {
    if (!isPostHogEnabled() || !pathname) return;

    const url = window.origin + pathname + window.location.search;
    posthog.capture("$pageview", { $current_url: url });
  }, [pathname]);

  return null;
}

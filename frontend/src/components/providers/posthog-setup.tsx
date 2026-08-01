"use client";

import { PostHogClickTracking } from "@/cloud/posthog-click-tracking";
import { PostHogPageview } from "./posthog-pageview";
import { usePostHogIdentify } from "@/domains/shared/application/hooks/use-posthog-identify";

function PostHogIdentify() {
  usePostHogIdentify();
  return null;
}

export function PostHogSetup() {
  return (
    <>
      <PostHogIdentify />
      <PostHogClickTracking />
      <PostHogPageview />
    </>
  );
}

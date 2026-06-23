"use client";

import { useEffect } from "react";
import { authClient } from "@/lib/auth-client";
import { isPostHogEnabled, posthog } from "@/lib/posthog";

const INTERNAL_EMAIL_DOMAINS = ["@almirant.ai"];

const ADMIN_EMAILS: string[] = [];

const isInternalUser = (email: string): boolean =>
  INTERNAL_EMAIL_DOMAINS.some((domain) => email.endsWith(domain));

export const isAdminUser = (email: string): boolean =>
  ADMIN_EMAILS.includes(email) || isInternalUser(email);

export const usePostHogIdentify = () => {
  const { data: session } = authClient.useSession();

  useEffect(() => {
    if (!isPostHogEnabled() || !session?.user) return;

    const { id, email, name } = session.user;

    // Always identify so feature flags evaluate correctly.
    // For internal users, disable event capture and session recording
    // but keep feature flag evaluation active.
    posthog.identify(id, { email, name });

    if (isInternalUser(email)) {
      posthog.set_config({ disable_session_recording: true });
    }
  }, [session?.user]);
};

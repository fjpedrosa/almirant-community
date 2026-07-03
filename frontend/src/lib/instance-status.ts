import { authBackendFetch } from "./server-session";

export interface InstanceOnboardingState {
  completed: boolean;
  hasUsers: boolean;
}

/**
 * Instance onboarding state, read from the BACKEND (the frontend has no database
 * connection). Sourced from `GET /api/auth/bootstrap-status`, which returns
 * `hasUsers` + `onboardingCompleted` (alongside the auth bootstrap fields).
 *
 * Fail-safe default when the backend is unreachable: assume onboarding is done
 * and users exist, so a transient blip never traps a user in the setup wizard.
 */
const FALLBACK: InstanceOnboardingState = { completed: true, hasUsers: true };

type BootstrapPayload = {
  onboardingCompleted?: boolean;
  hasUsers?: boolean;
};

export const getInstanceOnboardingState =
  async (): Promise<InstanceOnboardingState> => {
    try {
      const res = await authBackendFetch("/bootstrap-status");
      if (!res.ok) return FALLBACK;

      const json = (await res.json()) as
        | { data?: BootstrapPayload }
        | BootstrapPayload;
      const data =
        (json as { data?: BootstrapPayload }).data ??
        (json as BootstrapPayload);

      return {
        completed: data?.onboardingCompleted ?? true,
        hasUsers: data?.hasUsers ?? true,
      };
    } catch {
      return FALLBACK;
    }
  };

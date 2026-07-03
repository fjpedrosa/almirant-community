import type { EnabledAuthProviders } from "@/domains/auth/domain/types";
import { authBackendFetch } from "./server-session";

/**
 * Which social sign-in providers are enabled lives on the BACKEND (Elysia API):
 * the frontend is a thin client. Public login/signup server components fetch
 * `GET /api/auth/providers` (mounted alongside `/api/auth/bootstrap-status`,
 * before the Better-Auth wildcard) which returns
 * `{ success, data: { providers: [{ id, displayName, type }] } }` with ids like
 * `"email-password"`, `"google"`, `"github"`.
 *
 * FAIL-SAFE default when the backend is unreachable/malformed: every provider
 * `false`, so a transient backend blip never renders a social button that
 * cannot complete — the email/password form is always available regardless.
 */
const FALLBACK: EnabledAuthProviders = { google: false, github: false };

interface RawProvider {
  id?: unknown;
}

export const getEnabledAuthProviders =
  async (): Promise<EnabledAuthProviders> => {
    try {
      const res = await authBackendFetch("/providers");
      if (!res.ok) return FALLBACK;

      // The API wraps payloads in `{ success, data }`; tolerate a bare object too.
      const json = (await res.json()) as
        | { data?: { providers?: RawProvider[] }; providers?: RawProvider[] }
        | null;

      const providers = json?.data?.providers ?? json?.providers ?? null;
      if (!Array.isArray(providers)) return FALLBACK;

      const ids = new Set(
        providers
          .map((provider) => (typeof provider?.id === "string" ? provider.id : null))
          .filter((id): id is string => id !== null),
      );

      return {
        google: ids.has("google"),
        github: ids.has("github"),
      };
    } catch {
      return FALLBACK;
    }
  };

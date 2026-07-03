import type { AuthBootstrapStatus } from "@/domains/auth/domain/types";
import { authBackendFetch } from "./server-session";

/**
 * Auth bootstrap status now lives on the BACKEND (Elysia API): the frontend is a
 * thin client with NO database connection. Server components on the public
 * login/signup pages fetch `GET /api/auth/bootstrap-status` (mounted alongside
 * `/api/auth/providers`, before the Better-Auth wildcard).
 *
 * Fail-closed default when the backend is unreachable: assume an initialized,
 * registration-closed instance so a transient backend blip never accidentally
 * exposes the signup form or the first-admin setup flow.
 */
const FALLBACK: AuthBootstrapStatus = {
  hasUsers: true,
  needsInitialAdminSetup: false,
  allowRegistration: false,
};

export const getAuthBootstrapStatus = async (): Promise<AuthBootstrapStatus> => {
  try {
    const res = await authBackendFetch("/bootstrap-status");
    if (!res.ok) return FALLBACK;

    // The API wraps payloads in `{ success, data }`; tolerate a bare object too.
    const json = (await res.json()) as
      | { data?: AuthBootstrapStatus }
      | AuthBootstrapStatus;
    const status =
      (json as { data?: AuthBootstrapStatus }).data ??
      (json as AuthBootstrapStatus);

    if (
      !status ||
      typeof status.hasUsers !== "boolean" ||
      typeof status.allowRegistration !== "boolean"
    ) {
      return FALLBACK;
    }
    return status;
  } catch {
    return FALLBACK;
  }
};

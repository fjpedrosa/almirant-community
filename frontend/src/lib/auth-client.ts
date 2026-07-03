import { createAuthClient } from "better-auth/react";
import {
  inferAdditionalFields,
  organizationClient,
} from "better-auth/client/plugins";

/**
 * Resolve the Better-Auth origin the client should talk to. Auth now lives on
 * the BACKEND (Elysia API), so point the client at that origin.
 *
 *  - `NEXT_PUBLIC_AUTH_URL` — dedicated auth origin (e.g. https://api.almirant.ai)
 *  - falls back to `NEXT_PUBLIC_API_URL`
 *  - if the resolved value is a relative path (e.g. "/api" in same-origin
 *    self-host), leave `baseURL` undefined so the client uses the current origin.
 */
const resolveAuthBaseURL = (): string | undefined => {
  const raw = process.env.NEXT_PUBLIC_AUTH_URL || process.env.NEXT_PUBLIC_API_URL;
  if (!raw || raw.startsWith("/")) return undefined;
  return raw;
};

export const authClient = createAuthClient({
  // `undefined` = same-origin (self-host behind the /api rewrite). A concrete
  // origin (cloud) makes the client call `${origin}/api/auth/*` on the backend.
  baseURL: resolveAuthBaseURL(),
  fetchOptions: {
    credentials: "include",
  },
  plugins: [
    organizationClient(),
    // The server `auth` instance no longer lives in the frontend, so we cannot
    // do `inferAdditionalFields<typeof auth>()`. Describe the additional user
    // fields (configured on the backend auth instance) via the runtime schema
    // form instead — this is the Better-Auth-supported approach when the server
    // type cannot be imported.
    inferAdditionalFields({
      user: {
        // `input: false` mirrors the backend auth instance — these are
        // server-managed fields, NOT part of the sign-up/sign-in input (without
        // this the client would type them as required signUp args).
        role: { type: "string", input: false },
        locale: { type: "string", input: false },
      },
    }),
  ],
});

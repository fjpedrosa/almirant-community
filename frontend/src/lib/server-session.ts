import { cookies, headers } from "next/headers";

/**
 * Server-side session access against the Better-Auth instance that now lives on
 * the BACKEND (Elysia API). The Next.js frontend no longer runs a Better-Auth
 * server; instead every server render / route handler that needs a session
 * forwards the incoming request cookies to `${AUTH_ORIGIN}/api/auth/*`.
 *
 * `AUTH_ORIGIN` is the backend origin:
 *  - server-to-server, prefer the internal `BACKEND_URL` (matches
 *    `lib/api/server-client.ts`)
 *  - else the public auth origin `NEXT_PUBLIC_AUTH_URL`
 *  - else derive it from `NEXT_PUBLIC_API_URL` (stripping a trailing `/api`)
 *  - else the dev default `http://localhost:3001`
 */

const stripTrailingSlash = (value: string): string => value.replace(/\/+$/, "");

const resolveBackendOrigin = (): string => {
  const backendUrl = process.env.BACKEND_URL?.trim();
  if (backendUrl) return stripTrailingSlash(backendUrl);

  const authUrl = process.env.NEXT_PUBLIC_AUTH_URL?.trim();
  if (authUrl && !authUrl.startsWith("/")) return stripTrailingSlash(authUrl);

  const apiUrl = process.env.NEXT_PUBLIC_API_URL?.trim();
  if (apiUrl && !apiUrl.startsWith("/")) {
    return stripTrailingSlash(apiUrl).replace(/\/api$/, "");
  }

  return "http://localhost:3001";
};

/** Better-Auth is mounted at `${origin}/api/auth/*` on the backend. */
const AUTH_BASE = `${resolveBackendOrigin()}/api/auth`;

/** Shape returned by `GET /api/auth/get-session` (Better-Auth). */
export interface ServerSession {
  session: {
    id: string;
    token: string;
    userId: string;
    expiresAt: string;
    /** Populated by the organization plugin. `null` until a workspace is active. */
    activeOrganizationId: string | null;
  };
  user: {
    id: string;
    email: string;
    name: string;
    /** Additional field configured on the server auth instance. */
    role: string;
    /** Additional field configured on the server auth instance. */
    locale: string;
  };
}

/**
 * Low-level helper: call a Better-Auth endpoint on the backend, forwarding the
 * incoming request cookies (so the session travels with the request) and
 * disabling the Next.js data cache. Callers own status/body handling.
 */
export async function authBackendFetch(
  path: string,
  init: RequestInit = {},
): Promise<Response> {
  const incoming = await headers();
  const cookie = incoming.get("cookie") ?? "";

  return fetch(`${AUTH_BASE}${path}`, {
    ...init,
    headers: {
      ...(init.headers as Record<string, string> | undefined),
      ...(cookie ? { cookie } : {}),
    },
    cache: "no-store",
  });
}

/**
 * Resolve the current session by forwarding the request cookies to the backend
 * Better-Auth `get-session` endpoint. Returns `null` when unauthenticated
 * (Better-Auth returns a JSON `null` body with a 200 status in that case).
 *
 * Reuse this in every server component / route handler that previously called
 * `getAuth().api.getSession({ headers })`.
 */
export async function getServerSession(): Promise<ServerSession | null> {
  // Cheap short-circuit: no cookies means no session, skip the round trip.
  const incoming = await headers();
  if (!incoming.get("cookie")) return null;

  try {
    const res = await authBackendFetch("/get-session");
    if (!res.ok) return null;

    const data = (await res.json()) as ServerSession | null;
    if (!data || !data.session) return null;

    return data;
  } catch {
    // Network/parse failure — treat as unauthenticated so callers can redirect.
    return null;
  }
}

/**
 * Best-effort propagation of any `Set-Cookie` headers a Better-Auth mutation
 * (e.g. `set-active`) returns onto the outgoing response.
 *
 * NOTE: Next.js only permits cookie mutation inside Route Handlers and Server
 * Actions. During an RSC (layout/page) render `cookies().set()` throws — that
 * is expected and swallowed here, because the backend has ALREADY persisted the
 * change to the session row (the cookie is only a client-side cache), so the
 * next request's `getServerSession()` reflects it regardless.
 */
export async function forwardSetCookies(response: Response): Promise<void> {
  const setCookies = response.headers.getSetCookie?.() ?? [];
  if (setCookies.length === 0) return;

  try {
    const store = await cookies();

    for (const raw of setCookies) {
      const [pair, ...attrParts] = raw.split(";");
      const eq = pair.indexOf("=");
      if (eq === -1) continue;

      const name = pair.slice(0, eq).trim();
      const value = pair.slice(eq + 1).trim();

      const options: Parameters<typeof store.set>[2] = {};
      for (const attr of attrParts) {
        const [key, val] = attr.split("=");
        const flag = key.trim().toLowerCase();
        if (flag === "path") options.path = val?.trim();
        else if (flag === "domain") options.domain = val?.trim();
        else if (flag === "max-age") options.maxAge = Number(val?.trim());
        else if (flag === "expires") options.expires = new Date(val?.trim());
        else if (flag === "httponly") options.httpOnly = true;
        else if (flag === "secure") options.secure = true;
        else if (flag === "samesite") {
          const sameSite = val?.trim().toLowerCase();
          if (sameSite === "lax" || sameSite === "strict" || sameSite === "none") {
            options.sameSite = sameSite;
          }
        }
      }

      store.set(name, value, options);
    }
  } catch {
    // RSC render context (cookie mutation disallowed) — safe to ignore; the
    // backend already persisted the change server-side.
  }
}

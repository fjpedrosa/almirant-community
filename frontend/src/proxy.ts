import { NextRequest, NextResponse } from "next/server";
import { getSessionCookie } from "better-auth/cookies";
import { locales, type Locale } from "@/i18n/config";

const PUBLIC_PATH_PREFIXES = [
  "/accept-invitation",
  "/cli-auth",
  "/pricing",
  "/signup",
  "/waitlist",
];

const BACKEND_PASSTHROUGH_PATH_PREFIXES = ["/mcp"];

const SYSTEM_PATH_ALLOWLIST = [
  "/.well-known/oauth-authorization-server",
  "/.well-known/oauth-protected-resource",
];

const isPublicAssetRequest = (pathname: string): boolean =>
  /\.[^/]+$/.test(pathname);

const isSystemPath = (pathname: string): boolean =>
  pathname.split("/").some((segment) => segment.startsWith("."));

const SAFE_METHODS = new Set(["GET", "HEAD"]);

/**
 * Auth session token cookie names in priority order.
 * Better-Auth may use different prefixes depending on environment.
 */
const SESSION_TOKEN_CANDIDATES = [
  "__Host-better-auth.session_token",
  "__Secure-better-auth.session_token",
  "better-auth.session_token",
] as const;

/**
 * Marker cookie to avoid hitting the API on every request.
 * The value stores the session token hash so we re-sync when the session changes.
 */
const LOCALE_SYNCED_COOKIE = "locale-synced";

/**
 * How long the locale-synced marker is valid (in seconds).
 * After this, we'll re-check the user's locale from the DB.
 */
const LOCALE_SYNC_TTL_SECONDS = 3600; // 1 hour

/**
 * Resolve the backend API URL for server-side requests.
 * Proxy runs server-side, so we can use the internal backend URL.
 */
const resolveBackendUrl = (): string => {
  const backendUrl = process.env.BACKEND_URL?.trim();
  if (backendUrl) {
    return backendUrl.replace(/\/+$/, "");
  }

  const publicApiUrl = process.env.NEXT_PUBLIC_API_URL?.trim();
  if (publicApiUrl && !publicApiUrl.startsWith("/")) {
    return publicApiUrl.replace(/\/api\/?$/, "").replace(/\/+$/, "");
  }

  return "http://localhost:3001";
};

/**
 * Get the session token from cookies.
 */
const getSessionToken = (request: NextRequest): string | null => {
  for (const name of SESSION_TOKEN_CANDIDATES) {
    const cookie = request.cookies.get(name);
    if (cookie?.value) {
      return cookie.value;
    }
  }
  return null;
};

/**
 * Create a simple hash of the session token for the marker cookie.
 * This allows us to detect session changes without storing the full token.
 */
const hashToken = (token: string): string => {
  // Simple hash: use first 8 chars + length
  return `${token.slice(0, 8)}-${token.length}`;
};

/**
 * Check if we need to sync the locale (marker cookie missing or session changed).
 */
const needsLocaleSync = (
  request: NextRequest,
  sessionToken: string | null
): boolean => {
  if (!sessionToken) {
    // No session = no need to sync user locale
    return false;
  }

  const syncedCookie = request.cookies.get(LOCALE_SYNCED_COOKIE);
  if (!syncedCookie?.value) {
    // No marker = need to sync
    return true;
  }

  // Check if the session has changed
  const expectedHash = hashToken(sessionToken);
  return syncedCookie.value !== expectedHash;
};

interface UserResponse {
  success: boolean;
  data?: {
    locale?: string;
  };
  error?: string;
}

/**
 * Fetch the user's locale from the backend API.
 */
const fetchUserLocale = async (
  sessionToken: string
): Promise<Locale | null> => {
  const backendUrl = resolveBackendUrl();
  const url = `${backendUrl}/api/users/me`;

  try {
    const response = await fetch(url, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${sessionToken}`,
        "Content-Type": "application/json",
      },
      cache: "no-store",
      signal: AbortSignal.timeout(2000),
    });

    if (!response.ok) {
      // User not authenticated or other error - don't fail the request
      return null;
    }

    const data = (await response.json()) as UserResponse;
    if (!data.success || !data.data?.locale) {
      return null;
    }

    const userLocale = data.data.locale;
    if (locales.includes(userLocale as Locale)) {
      return userLocale as Locale;
    }

    return null;
  } catch {
    // Network error - don't fail the request
    return null;
  }
};

/**
 * Sync locale cookie from user's database preference.
 * Only syncs when the session changes or the marker cookie has expired.
 */
const syncLocale = async (
  request: NextRequest,
  response: NextResponse
): Promise<void> => {
  const sessionToken = getSessionToken(request);

  // Check if we need to sync locale
  if (!needsLocaleSync(request, sessionToken)) {
    return;
  }

  // Fetch user locale from API
  const userLocale = await fetchUserLocale(sessionToken!);
  if (!userLocale) {
    // Could not get user locale - set marker to avoid retrying on every request
    if (sessionToken) {
      response.cookies.set(LOCALE_SYNCED_COOKIE, hashToken(sessionToken), {
        maxAge: LOCALE_SYNC_TTL_SECONDS,
        httpOnly: true,
        sameSite: "lax",
        path: "/",
      });
    }
    return;
  }

  // Compare with current locale cookie
  const currentLocale = request.cookies.get("locale")?.value;

  if (currentLocale !== userLocale) {
    // Sync locale cookie
    response.cookies.set("locale", userLocale, {
      maxAge: 60 * 60 * 24 * 365, // 1 year
      httpOnly: false, // Client-side code may need to read this
      sameSite: "lax",
      path: "/",
    });
  }

  // Set marker cookie to avoid re-syncing on every request
  response.cookies.set(LOCALE_SYNCED_COOKIE, hashToken(sessionToken!), {
    maxAge: LOCALE_SYNC_TTL_SECONDS,
    httpOnly: true,
    sameSite: "lax",
    path: "/",
  });
};

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-pathname", pathname);

  if (
    SYSTEM_PATH_ALLOWLIST.includes(pathname) ||
    BACKEND_PASSTHROUGH_PATH_PREFIXES.some(
      (path) => pathname === path || pathname.startsWith(`${path}/`),
    )
  ) {
    return NextResponse.next({
      request: {
        headers: requestHeaders,
      },
    });
  }

  // Block system paths (e.g. /.well-known) as defense-in-depth
  if (isSystemPath(pathname)) {
    return new NextResponse("Not Found", { status: 404 });
  }

  const isPublic =
    pathname === "/" ||
    isPublicAssetRequest(pathname) ||
    PUBLIC_PATH_PREFIXES.some(
      (path) => pathname === path || pathname.startsWith(`${path}/`),
    );

  if (isPublic) {
    // Reject non-GET/HEAD requests to marketing/public routes (bot protection)
    if (!SAFE_METHODS.has(request.method)) {
      return new NextResponse("Method Not Allowed", { status: 405 });
    }

    return NextResponse.next({
      request: {
        headers: requestHeaders,
      },
    });
  }

  const sessionCookie = getSessionCookie(request);

  if (!sessionCookie) {
    return NextResponse.redirect(new URL("/sign-in", request.url));
  }

  // Create response and sync locale for authenticated users
  const response = NextResponse.next({
    request: {
      headers: requestHeaders,
    },
  });

  // Sync locale from user's database preference
  await syncLocale(request, response);

  return response;
}

export const config = {
  matcher: ["/((?!api|mcp|ingest|_next/static|_next/image|sign-in|signup|.*\\..*).*)"],
};

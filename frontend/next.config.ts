// Coolify preview: resolve {{pr_id}} in env vars from COOLIFY_FQDN.
// Must run before any env var reads (NEXT_PUBLIC_* are embedded at build time).
// Safe for production: COOLIFY_FQDN without a PR number (e.g. "almirant.ai") → no-op.
const _coolifyFqdn = process.env.COOLIFY_FQDN;
if (_coolifyFqdn) {
  const _prMatch = _coolifyFqdn.match(/(?:^|-)(\d+)\./);
  if (_prMatch) {
    const _prId = _prMatch[1];
    for (const _key of Object.keys(process.env)) {
      if (process.env[_key]?.includes("{{pr_id}}")) {
        process.env[_key] = process.env[_key]!.replace(/\{\{pr_id\}\}/g, _prId);
      }
    }
  }
}

import { resolve } from "path";
import type { NextConfig } from "next";
import { withSentryConfig } from "@sentry/nextjs";
import createNextIntlPlugin from "next-intl/plugin";
import {
  getDefaultLocalFrontendOrigins,
  normalizeApiBaseUrl,
} from "./src/lib/runtime-service-url";

const resolveBackendUrl = (): string => {
  const backendUrl = process.env.BACKEND_URL?.trim();
  if (backendUrl) {
    return backendUrl.replace(/\/+$/, "");
  }

  const publicApiUrl = process.env.NEXT_PUBLIC_API_URL?.trim();
  if (publicApiUrl) {
    return (normalizeApiBaseUrl(publicApiUrl) ?? publicApiUrl)
      .replace(/\/api\/?$/, "")
      .replace(/\/+$/, "");
  }

  return "http://localhost:3001";
};

const BACKEND_URL = resolveBackendUrl();
const LOCAL_DEV_ALLOWED_ORIGINS = getDefaultLocalFrontendOrigins(process.env).map(
  (origin) => new URL(origin).host
);
const SENTRY_ORG = process.env.SENTRY_ORG?.trim();
const SENTRY_PROJECT = process.env.SENTRY_PROJECT?.trim();
const SENTRY_AUTH_TOKEN = process.env.SENTRY_AUTH_TOKEN?.trim();
const SHOULD_UPLOAD_SENTRY_SOURCEMAPS = Boolean(
  SENTRY_ORG && SENTRY_PROJECT && SENTRY_AUTH_TOKEN,
);
const NEXT_LOCAL_API_ROUTES = "auth|ws-token";

const nextConfig: NextConfig = {
  // Emit a minimal production server with only traced runtime files.
  // Docker can then copy .next/standalone instead of the whole app + node_modules.
  // On Vercel, leave output at its default — `standalone` breaks Vercel routing
  // (every route 404s), so only emit it for the Docker/Coolify self-host build.
  output: process.env.VERCEL ? undefined : "standalone",
  // Required for PostHog reverse proxy — prevents 308 redirects on POST requests to /ingest/e/
  skipTrailingSlashRedirect: true,
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "avatars.githubusercontent.com",
      },
      {
        protocol: "https",
        hostname: "lh3.googleusercontent.com",
      },
    ],
  },
  experimental: {
    serverActions: {
      allowedOrigins: [
        "almirant.ai",
        "www.almirant.ai",
        ...LOCAL_DEV_ALLOWED_ORIGINS,
        // Allow preview deployments (e.g. 493.almirant.ai)
        ...(process.env.BETTER_AUTH_URL
          ? [new URL(process.env.BETTER_AUTH_URL).host]
          : []),
      ],
    },
  },
  turbopack: {
    root: resolve(__dirname, ".."),
  },
  async headers() {
    return [
      {
        // Serve .well-known paths with the correct JSON content type
        source: "/.well-known/:path*",
        headers: [
          {
            key: "Content-Type",
            value: "application/json",
          },
        ],
      },
    ];
  },
  async rewrites() {
    return {
      beforeFiles: [
        // Self-hosted/Tailscale setups can expose the frontend directly
        // (for example via `tailscale serve`). These must run before App
        // Router filesystem matching, otherwise the app shell/proxy can handle
        // `/mcp` first and redirect the CLI to `/sign-in`.
        {
          source: "/mcp",
          destination: `${BACKEND_URL}/mcp`,
        },
        {
          source: "/mcp/:path*",
          destination: `${BACKEND_URL}/mcp/:path*`,
        },
        {
          source: "/.well-known/oauth-authorization-server",
          destination: `${BACKEND_URL}/.well-known/oauth-authorization-server`,
        },
        {
          source: "/.well-known/oauth-protected-resource",
          destination: `${BACKEND_URL}/.well-known/oauth-protected-resource`,
        },
        // Defensive compatibility for older/self-edited installs that baked
        // NEXT_PUBLIC_API_URL=/api/api into the frontend bundle. The client also
        // normalizes this, but the proxy should be forgiving because this is a
        // self-hosted upgrade path, not just a clean deploy path.
        // Older bundles also called the onboarding status endpoint under
        // `/instance`, while the backend canonical route is `/api/onboarding`.
        {
          source: "/api/api/instance/onboarding",
          destination: `${BACKEND_URL}/api/onboarding`,
        },
        {
          source: "/api/api/instance/onboarding/:path*",
          destination: `${BACKEND_URL}/api/onboarding/:path*`,
        },
        {
          source: "/api/api",
          destination: `${BACKEND_URL}/api`,
        },
        {
          source: "/api/api/:path*",
          destination: `${BACKEND_URL}/api/:path*`,
        },
        // The published CLI normalizes self-hosted API URLs to `/api` before
        // appending `/mcp`, so keep `/api/mcp` as a first-class alias for the
        // backend MCP mount.
        {
          source: "/api/mcp",
          destination: `${BACKEND_URL}/mcp`,
        },
        {
          source: "/api/mcp/:path*",
          destination: `${BACKEND_URL}/mcp/:path*`,
        },
        // Keep frontend-owned App Router API routes in Next. This catch-all
        // exists so browser calls to `/api/*` reach the backend in self-hosted
        // deployments, but `beforeFiles` rewrites run before App Router route
        // matching. Without this allowlist, local handlers like `/api/ws-token`
        // are swallowed by the backend proxy and return backend 404s.
        {
          source: `/api/:path((?!${NEXT_LOCAL_API_ROUTES}).*)`,
          destination: `${BACKEND_URL}/api/:path*`,
        },
        {
          source: "/ws",
          destination: `${BACKEND_URL}/ws`,
        },
      ],
      afterFiles: [
        // PostHog reverse proxy — avoids ad-blockers
        {
          source: "/ingest/static/:path*",
          destination: "https://eu-assets.i.posthog.com/static/:path*",
        },
        {
          source: "/ingest/:path*",
          destination: "https://eu.i.posthog.com/:path*",
        },
      ],
    };
  },
  async redirects() {
    return [
      {
        source: "/backoffice/feedback/bug-fixes",
        destination: "/backoffice",
        permanent: true,
      },
      {
        source: "/backoffice/feedback/metrics",
        destination: "/backoffice/analytics/feedback",
        permanent: true,
      },
    ];
  },
};

const withNextIntl = createNextIntlPlugin();

const sentryBuildOptions = {
  // Only print logs for uploading source maps in CI
  silent: !process.env.CI,

  // For all available options, see:
  // https://docs.sentry.io/platforms/javascript/guides/nextjs/manual-setup/

  // Upload a larger set of source maps for prettier stack traces (increases build time)
  widenClientFileUpload: true,
  sourcemaps: {
    disable: !SHOULD_UPLOAD_SENTRY_SOURCEMAPS,
  },
  errorHandler: (error: Error) => {
    console.warn(
      "[Sentry] Skipping sourcemap upload because the Sentry project configuration is invalid or unavailable.",
      error.message,
    );

    if (process.env.SENTRY_STRICT_BUILD === "true") {
      throw error;
    }
  },

  // Uncomment to route browser requests to Sentry through a Next.js rewrite to circumvent ad-blockers.
  // This can increase your server load as well as your hosting bill.
  // Note: Check that the configured route will not match with your Next.js middleware, otherwise reporting of client-
  // side errors will fail.
  // tunnelRoute: "/monitoring",

  webpack: {
    // Enables automatic instrumentation of Vercel Cron Monitors. (Does not yet work with App Router route handlers.)
    // See the following for more information:
    // https://docs.sentry.io/product/crons/
    // https://vercel.com/docs/cron-jobs
    automaticVercelMonitors: true,

    // Tree-shaking options for reducing bundle size
    treeshake: {
      // Automatically tree-shake Sentry logger statements to reduce bundle size
      removeDebugLogging: true,
    },
  },
  ...(SENTRY_ORG ? { org: SENTRY_ORG } : {}),
  ...(SENTRY_PROJECT ? { project: SENTRY_PROJECT } : {}),
  ...(SENTRY_AUTH_TOKEN ? { authToken: SENTRY_AUTH_TOKEN } : {}),
};

export default withSentryConfig(withNextIntl(nextConfig), sentryBuildOptions);

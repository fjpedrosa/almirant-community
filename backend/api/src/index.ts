import * as Sentry from "@sentry/bun";
import { Elysia } from "elysia";
import { cors } from "@elysiajs/cors";
import { mcp } from "elysia-mcp";
import type { ILogger } from "elysia-mcp";
import { env, logger } from "@almirant/config";
import { initRuntimeCors, isOriginAllowed } from "./shared/services/runtime-cors";

if (env.SENTRY_DSN && env.NODE_ENV !== "development") {
  Sentry.init({
    dsn: env.SENTRY_DSN,
    environment: env.NODE_ENV,
    tracesSampleRate: 1.0,
  });
}

import { closeConnections } from "@almirant/database";
import { shutdownPostHog } from "./shared/services/posthog-service";
import { errorMiddleware } from "./shared/middleware/error.middleware";
import { loggerMiddleware } from "./shared/middleware/logger.middleware";
import { setupPublicMcpServer } from "./mcp/setup/public";
import { createMcpAuthenticator } from "./mcp/auth/authenticate";
import { sessionAuthMiddleware, requireAuth, requireWorkspace } from "./shared/middleware/session-auth.middleware";

// Domain modules
import { documentCategoriesModule } from "./domains/documents/categories";
import { documentsModule } from "./domains/documents";
import { authModule } from "./domains/auth";
import { observabilityModule } from "./domains/observability";
import { notificationsModule } from "./domains/notifications";
import { billingModule } from "./domains/billing";
import { connectionsModule } from "./domains/connections";
import { ideationModule } from "./domains/ideation";
import { aiModule } from "./domains/ai";
import { integrationsModule } from "./domains/integrations";
import { projectManagementModule } from "./domains/project-management";
import { webhooksModule } from "./domains/webhooks";
import { agentsModule } from "./domains/agents";
import { instanceModule } from "./domains/instance";
import { handbookModule } from "./domains/handbook";
import { wsHandler } from "./shared/ws/ws-handler";
import { startBackgroundJobs } from "./background";
import { bootstrapExtensions, bootstrapRuntimeSettings } from "./bootstrap";

// Public auth-providers listing (no session required — consumed by the login page)
import { authProvidersRoutes } from "./routes/auth-providers.routes";
// Better-Auth issuer handler (mounted at ROOT, serves all /api/auth/*)
import { betterAuthRoutes } from "./domains/auth/routes/better-auth.routes";
import {
  buildMcpOAuthAuthorizationServerMetadata,
  buildMcpOAuthProtectedResourceMetadata,
} from "./domains/auth/routes/mcp-oauth.routes";

bootstrapExtensions();

// Warm runtime caches (reads from instance_settings) before any handler runs.
// `bootstrapRuntimeSettings` injects the auto-provisioned internal feedback
// project UUID so feedback flows work without operators setting ALMIRANT_PROJECT_ID.
// `initRuntimeCors` accepts Tailscale URLs without restart.
await bootstrapRuntimeSettings();
await initRuntimeCors();

// Adapter: project logger (pino-style) -> elysia-mcp ILogger (printf-style)
const mcpLogger: ILogger = {
  info: (msg: string, ...args: unknown[]) => logger.info(msg, ...args),
  error: (msg: string, ...args: unknown[]) => logger.error(msg, ...args),
  warn: (msg: string, ...args: unknown[]) => logger.warn(msg, ...args),
  debug: (msg: string, ...args: unknown[]) => logger.debug(msg, ...args),
};

// MCP request timeout: 120 seconds (protects against hung database queries or S3 uploads)
const MCP_REQUEST_TIMEOUT_MS = 120_000;

// ─── MCP connection tracking ───────────────────────────────────────────────────
// Track active MCP requests for diagnostics and graceful shutdown
interface McpRequestInfo {
  startedAt: number;
  method: string;
  toolName?: string;
}
const activeMcpRequests = new Map<string, McpRequestInfo>();
let totalMcpRequests = 0;
let failedMcpRequests = 0;
const mcpServerStartedAt = Date.now();

// MCP is exposed at two roots: `/mcp` (SaaS, dev, direct-to-backend) and
// `/api/mcp` (self-hosted reverse proxy that forwards `/api/*` without strip).
// Use this helper everywhere we need to detect "this request is for MCP".
const isMcpPath = (pathname: string): boolean =>
  pathname.startsWith("/mcp") || pathname.startsWith("/api/mcp");

const mcpHealthPayload = () => ({
  status: "ok",
  deployCheck: "backend-deploy-check-2026-02-21-02",
  uptimeMs: Date.now() - mcpServerStartedAt,
  uptimeFormatted: `${Math.floor((Date.now() - mcpServerStartedAt) / 1000 / 60)}m`,
  activeRequests: activeMcpRequests.size,
  totalRequests: totalMcpRequests,
  failedRequests: failedMcpRequests,
  memoryMB: Math.round(process.memoryUsage.rss() / 1024 / 1024),
  timestamp: new Date().toISOString(),
});

const app = new Elysia({
  serve: {
    idleTimeout: 0, // Disable idle timeout for long-lived SSE connections (MCP)
  },
})
  .use(cors({
    // Dynamic origin: env CORS_ORIGIN + publicUrl from instance_settings (DB).
    // Allows Tailscale URL to be accepted after wizard config without restart.
    origin: (request) => {
      const requestOrigin = request.headers.get("origin");
      if (!requestOrigin) return true;
      return isOriginAllowed(requestOrigin);
    },
    credentials: true,
  }))
  .use(loggerMiddleware)
  .use(errorMiddleware)
  // Health routes at root level (no auth) - required for Coolify/K8s probes
  .use(observabilityModule.public())
  // Integration webhooks at root level (no auth) — each integration verifies its own signatures
  .use(integrationsModule.public())
  // Resend inbound email webhooks at root level (no auth) - Resend sends webhooks without session
  .use(notificationsModule.public())
  // Dev-only test session endpoint (disabled in production)
  .use(authModule.public())
  // Public list of configured auth providers (consumed by the login page before auth)
  // Registered BEFORE the Better-Auth wildcard so the static
  // GET /api/auth/providers resolves first.
  .use(authProvidersRoutes)
  // Better-Auth issuer: handles all /api/auth/* (sign-in, sign-up, email/password,
  // Google OAuth, session, organization plugin). Mounted at ROOT (outside the
  // /api session-auth group) so it ISSUES sessions instead of consuming them.
  .use(betterAuthRoutes)
  // Public instance config (no auth) — consumed by frontend for runtime config
  .use(instanceModule.public())
  // Root endpoint with API metadata
  .get("/", () => ({
    name: "Almirant API",
    version: "1.0.0",
    status: "running",
  }))
  // OAuth metadata for ChatGPT/remote MCP clients.
  .get("/.well-known/oauth-authorization-server", ({ request }) =>
    new Response(JSON.stringify(buildMcpOAuthAuthorizationServerMetadata(request)), {
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": "no-store",
      },
    })
  )
  // RFC 9728 protected resource metadata — the MCP SDK checks this endpoint
  // BEFORE oauth-authorization-server.
  .get("/.well-known/oauth-protected-resource", ({ request }) =>
    new Response(JSON.stringify(buildMcpOAuthProtectedResourceMetadata(request)), {
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": "no-store",
      },
    })
  )
  // Public OAuth endpoints used by ChatGPT to obtain short-lived MCP tokens.
  .use(authModule.mcpOAuth())
  // ─── MCP diagnostics endpoint ───────────────────────────────────────────────
  // Unauthenticated health probe for MCP connectivity testing.
  // Returns server uptime, active/total/failed request counts, and memory usage.
  // Exposed at both `/mcp/health` (SaaS / direct-to-backend) and `/api/mcp/health`
  // (self-hosted with a reverse proxy that forwards `/api/*` without strip).
  .get("/mcp/health", () => mcpHealthPayload())
  .get("/api/mcp/health", () => mcpHealthPayload())
  // Ensure MCP requests have proper Accept header for Streamable HTTP compatibility.
  // Claude Code's HTTP transport sends "application/json, text/event-stream" but
  // older versions or custom clients may omit one. The elysia-mcp plugin rejects
  // POST requests that don't include BOTH in the Accept header (406 Not Acceptable).
  // We patch the header early to prevent silent 406 failures.
  .onBeforeHandle(({ request, headers }) => {
    if (isMcpPath(new URL(request.url).pathname)) {
      const accept = headers["accept"] ?? "";
      const parts = [accept];
      if (!accept.includes("application/json")) parts.push("application/json");
      if (!accept.includes("text/event-stream")) parts.push("text/event-stream");
      if (parts.length > 1) {
        headers["accept"] = parts.filter(Boolean).join(", ");
      }
    }
  })
  // ─── Public MCP mount (/mcp and /api/mcp) ───────────────────────────────────
  // 24 tools available to all authenticated callers (API keys + session tokens).
  // Debug tools are deliberately excluded from this mount.
  //
  // Two mounts intentionally:
  //   • `/mcp`     — used by SaaS (`api.almirant.ai/mcp`) and direct-to-backend
  //                  connections in development (`localhost:3001/mcp`).
  //   • `/api/mcp` — used by self-hosted installs where a reverse proxy fronts
  //                  the stack and forwards `/api/*` to the backend without
  //                  stripping the `/api` prefix. Without this alias, the CLI
  //                  configured with `--api-url https://host/api` cannot reach
  //                  MCP at all.
  .use(
    mcp({
      basePath: "/mcp",
      setupServer: setupPublicMcpServer,
      serverInfo: { name: "almirant-public", version: "1.0.0" },
      authentication: createMcpAuthenticator({ allowApiKeys: true, requiredPermission: null }),
      enableJsonResponse: true,
      stateless: true,
      logger: mcpLogger,
    })
  )
  .use(
    mcp({
      basePath: "/api/mcp",
      setupServer: setupPublicMcpServer,
      serverInfo: { name: "almirant-public", version: "1.0.0" },
      authentication: createMcpAuthenticator({ allowApiKeys: true, requiredPermission: null }),
      enableJsonResponse: true,
      stateless: true,
      logger: mcpLogger,
    })
  )
  // WebSocket handler (auth via query param token, no session middleware)
  .use(wsHandler)
  // Agent/worker endpoints (API key auth, no session)
  .use(agentsModule.public())
  // Public link-token complete endpoint (unauthenticated, used by CLI)
  .use(authModule.linkToken())
  // Document sync endpoints (API key auth, no session)
  .use(documentsModule.sync())
  // Document asset serving (public, for rendering images in docs)
  .use(documentsModule.assets())
  // GitHub PR creation (session OR API key auth)
  .use(integrationsModule.pullRequests())
  // Internal runner release-integration routes (API key auth, no session)
  .use(projectManagementModule.internal())
  .group("/api", (app) =>
    app
      // Alias for deployments whose worker API URL includes `/api`.
      // Must be mounted before session middleware, otherwise runner API keys
      // are interpreted as user sessions and receive 401.
      .use(projectManagementModule.internal())
      .use(sessionAuthMiddleware)
      .use(requireAuth)
      // ── Auth-only routes (no active workspace required) ──────────────
      // These routes need an authenticated user but must work before the
      // user has selected/created a workspace (e.g. right after login).
      .use(authModule.authOnly())
      .use(projectManagementModule.authOnly())
      // Instance onboarding (admin-only, no org required)
      .use(instanceModule.protected())
      // ── Workspace-scoped routes ─────────────────────────────────────
      // All remaining routes require an active workspace in the session.
      // Returns 403 "No active workspace" if none is set.
      .use(requireWorkspace)
      .use(projectManagementModule.protected())
      .use(webhooksModule.protected())
      .use(agentsModule.protected())
      .use(documentsModule.protected())
      .use(handbookModule.protected())
      .use(documentCategoriesModule())
      .use(authModule.protected())
      .use(integrationsModule.protected())
      .use(aiModule.protected())
      .use(notificationsModule.protected())
      .use(connectionsModule.protected())
      .use(observabilityModule.protected())
      .use(ideationModule.protected())
      .use(billingModule.protected())
      .use(documentsModule.uploads())
  )
  // ─── MCP request tracking & timeout middleware ──────────────────────────────
  // Tracks active MCP requests for the /mcp/health diagnostic endpoint
  // and enforces a request-level timeout to prevent hung tool calls from
  // holding connections open indefinitely (which can exhaust proxy limits).
  .onBeforeHandle(({ request, store }) => {
    if (isMcpPath(new URL(request.url).pathname)) {
      const requestId = crypto.randomUUID();
      const storeRecord = store as Record<string, unknown>;
      storeRecord.__mcpStart = Date.now();
      storeRecord.__mcpRequestId = requestId;

      // Extract JSON-RPC method from body if available (for logging)
      // Body is already parsed by Elysia at this point
      totalMcpRequests++;
      activeMcpRequests.set(requestId, {
        startedAt: Date.now(),
        method: request.method,
      });

      // Set a hard timeout to prevent hung requests from blocking proxy connections.
      // On timeout, the request tracking is cleaned up and an error is logged.
      // The actual HTTP response is still handled by Elysia's built-in timeout.
      const timeoutId = setTimeout(() => {
        if (activeMcpRequests.has(requestId)) {
          activeMcpRequests.delete(requestId);
          failedMcpRequests++;
          logger.warn(
            { requestId, path: new URL(request.url).pathname, method: request.method },
            `MCP request timed out after ${MCP_REQUEST_TIMEOUT_MS}ms`
          );
        }
      }, MCP_REQUEST_TIMEOUT_MS);

      storeRecord.__mcpTimeoutId = timeoutId;
    }
  })
  .onAfterHandle(({ request, store }) => {
    const storeRecord = store as Record<string, unknown>;
    const start = storeRecord.__mcpStart as number | undefined;
    const requestId = storeRecord.__mcpRequestId as string | undefined;
    const timeoutId = storeRecord.__mcpTimeoutId as ReturnType<typeof setTimeout> | undefined;

    if (start) {
      const duration = Date.now() - start;
      logger.info({ duration, path: new URL(request.url).pathname, method: request.method }, "MCP request completed");
    }
    if (requestId) {
      activeMcpRequests.delete(requestId);
    }
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
  })
  .onError(({ request, error, store }) => {
    const storeRecord = store as Record<string, unknown>;
    const start = storeRecord.__mcpStart as number | undefined;
    const requestId = storeRecord.__mcpRequestId as string | undefined;
    const timeoutId = storeRecord.__mcpTimeoutId as ReturnType<typeof setTimeout> | undefined;

    if (start) {
      const duration = Date.now() - start;
      failedMcpRequests++;
      logger.error(
        { duration, path: new URL(request.url).pathname, method: request.method, error: error instanceof Error ? error.message : String(error) },
        "MCP request failed"
      );
    }
    if (requestId) {
      activeMcpRequests.delete(requestId);
    }
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
  })
  .listen(env.PORT);

const backgroundJobs = startBackgroundJobs();

console.log(`
  Almirant API
  ========================
  Environment: ${env.NODE_ENV}
  Server: http://localhost:${env.PORT}
`);

// Global error handlers – prevent process crash from unhandled async errors in MCP tools
process.on("uncaughtException", (err) => {
  Sentry.captureException(err);
  logger.fatal(err, "Uncaught exception");
});

process.on("unhandledRejection", (reason) => {
  Sentry.captureException(reason);
  logger.fatal({ reason }, "Unhandled rejection");
});

// ─── Graceful shutdown ──────────────────────────────────────────────────────
// On SIGTERM (Coolify/Docker deploy) or SIGINT (Ctrl+C), we stop accepting new
// work and give in-flight MCP requests up to GRACEFUL_SHUTDOWN_MS to complete.
// This prevents "connection reset" errors for clients whose tool call is mid-flight.
const GRACEFUL_SHUTDOWN_MS = 10_000;
let isShuttingDown = false;

const shutdown = async () => {
  if (isShuttingDown) return; // prevent double-shutdown
  isShuttingDown = true;

  const activeCount = activeMcpRequests.size;
  logger.info({ activeCount }, "Shutting down — draining active MCP requests...");

  try {
    await backgroundJobs.stop();

    // Wait for in-flight MCP requests to finish (up to the grace period)
    if (activeCount > 0) {
      const drainStart = Date.now();
      while (activeMcpRequests.size > 0 && Date.now() - drainStart < GRACEFUL_SHUTDOWN_MS) {
        await new Promise((resolve) => setTimeout(resolve, 250));
      }
      if (activeMcpRequests.size > 0) {
        logger.warn(
          { remaining: activeMcpRequests.size },
          "Graceful shutdown timeout — forcing exit with active MCP requests"
        );
      } else {
        logger.info("All MCP requests drained successfully");
      }
    }

    await closeConnections();
    await shutdownPostHog();
  } catch (err) {
    logger.error(err, "Error during shutdown");
  }
  process.exit(0);
};

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

export type App = typeof app;

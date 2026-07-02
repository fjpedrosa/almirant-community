import { Elysia, t } from "elysia";
import { getConnectionById, updateConnectionLastUsedAt } from "@almirant/database";
import { env, logger } from "@almirant/config";
import {
  successResponse,
  errorResponse,
  notFoundResponse,
} from "../../../shared/services/response";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Fetch JSON from an external API with a timeout. Returns the parsed body
 * on success or a descriptive error string on failure.
 */
const fetchExternal = async (
  url: string,
  headers: Record<string, string>,
  timeoutMs = 15_000,
): Promise<{ ok: true; data: unknown } | { ok: false; error: string; statusCode: number }> => {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    const res = await fetch(url, {
      headers,
      signal: controller.signal,
    });

    clearTimeout(timer);

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      return {
        ok: false,
        error: `External API returned ${res.status}: ${body.slice(0, 200)}`,
        statusCode: 502,
      };
    }

    const data = await res.json();
    return { ok: true, data };
  } catch (err) {
    if (err instanceof DOMException && err.name === "AbortError") {
      return { ok: false, error: "External API request timed out", statusCode: 504 };
    }
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Failed to reach external API",
      statusCode: 502,
    };
  }
};

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

export const observabilityRoutes = new Elysia({ prefix: "/observability" })

  // -------------------------------------------------------------------
  // GET /observability/sentry/issues?connectionId=X
  // -------------------------------------------------------------------
  .get(
    "/sentry/issues",
    async (ctx) => {
      try {
        const userId = (ctx as unknown as { user: { id: string } }).user.id;
        const orgId = (ctx as unknown as { activeWorkspace: { id: string } }).activeWorkspace.id;

        const encryptionKey = env.ENCRYPTION_KEY;
        if (!encryptionKey) {
          ctx.set.status = 500;
          return errorResponse("Encryption key not configured. Set ENCRYPTION_KEY env variable.", 500);
        }

        const connection = await getConnectionById(ctx.query.connectionId, encryptionKey);
        if (!connection) {
          ctx.set.status = 404;
          return notFoundResponse("Connection");
        }

        const isOwner =
          (connection.scope === "user" && connection.scopeId === userId) ||
          (connection.scope === "organization" && connection.scopeId === orgId);
        if (!isOwner) {
          ctx.set.status = 404;
          return notFoundResponse("Connection");
        }

        const credentials = connection.credentials as Record<string, unknown> | undefined;
        if (!credentials) {
          ctx.set.status = 400;
          return errorResponse("Connection has no credentials configured");
        }

        const config = (connection.config ?? {}) as Record<string, unknown>;
        const apiKey = credentials.apiKey as string;
        const orgSlug = config.orgSlug as string | undefined;
        const projectSlug = config.projectSlug as string | undefined;

        if (!orgSlug || !projectSlug) {
          ctx.set.status = 400;
          return errorResponse(
            "Sentry connection is missing orgSlug or projectSlug in config. Update the connection settings.",
          );
        }

        const url = `https://sentry.io/api/0/projects/${orgSlug}/${projectSlug}/issues/?query=is:unresolved&sort=date&limit=25`;
        const res = await fetchExternal(url, {
          Authorization: `Bearer ${apiKey}`,
        });

        if (!res.ok) {
          ctx.set.status = res.statusCode;
          return errorResponse(res.error, res.statusCode);
        }

        void updateConnectionLastUsedAt(connection.id);
        return successResponse(res.data);
      } catch (error) {
        logger.error(error, "Failed to fetch Sentry issues");
        ctx.set.status = 500;
        return errorResponse(
          error instanceof Error ? error.message : "Failed to fetch Sentry issues",
          500,
        );
      }
    },
    {
      query: t.Object({
        connectionId: t.String(),
      }),
    },
  )

  // -------------------------------------------------------------------
  // GET /observability/sentry/stats?connectionId=X
  // -------------------------------------------------------------------
  .get(
    "/sentry/stats",
    async (ctx) => {
      try {
        const userId = (ctx as unknown as { user: { id: string } }).user.id;
        const orgId = (ctx as unknown as { activeWorkspace: { id: string } }).activeWorkspace.id;

        const encryptionKey = env.ENCRYPTION_KEY;
        if (!encryptionKey) {
          ctx.set.status = 500;
          return errorResponse("Encryption key not configured. Set ENCRYPTION_KEY env variable.", 500);
        }

        const connection = await getConnectionById(ctx.query.connectionId, encryptionKey);
        if (!connection) {
          ctx.set.status = 404;
          return notFoundResponse("Connection");
        }

        const isOwner =
          (connection.scope === "user" && connection.scopeId === userId) ||
          (connection.scope === "organization" && connection.scopeId === orgId);
        if (!isOwner) {
          ctx.set.status = 404;
          return notFoundResponse("Connection");
        }

        const credentials = connection.credentials as Record<string, unknown> | undefined;
        if (!credentials) {
          ctx.set.status = 400;
          return errorResponse("Connection has no credentials configured");
        }

        const config = (connection.config ?? {}) as Record<string, unknown>;
        const apiKey = credentials.apiKey as string;
        const orgSlug = config.orgSlug as string | undefined;
        const projectSlug = config.projectSlug as string | undefined;

        if (!orgSlug || !projectSlug) {
          ctx.set.status = 400;
          return errorResponse(
            "Sentry connection is missing orgSlug or projectSlug in config. Update the connection settings.",
          );
        }

        const url = `https://sentry.io/api/0/projects/${orgSlug}/${projectSlug}/stats/`;
        const res = await fetchExternal(url, {
          Authorization: `Bearer ${apiKey}`,
        });

        if (!res.ok) {
          ctx.set.status = res.statusCode;
          return errorResponse(res.error, res.statusCode);
        }

        void updateConnectionLastUsedAt(connection.id);
        return successResponse(res.data);
      } catch (error) {
        logger.error(error, "Failed to fetch Sentry stats");
        ctx.set.status = 500;
        return errorResponse(
          error instanceof Error ? error.message : "Failed to fetch Sentry stats",
          500,
        );
      }
    },
    {
      query: t.Object({
        connectionId: t.String(),
      }),
    },
  )

  // -------------------------------------------------------------------
  // GET /observability/posthog/insights?connectionId=X
  // -------------------------------------------------------------------
  .get(
    "/posthog/insights",
    async (ctx) => {
      try {
        const userId = (ctx as unknown as { user: { id: string } }).user.id;
        const orgId = (ctx as unknown as { activeWorkspace: { id: string } }).activeWorkspace.id;

        const encryptionKey = env.ENCRYPTION_KEY;
        if (!encryptionKey) {
          ctx.set.status = 500;
          return errorResponse("Encryption key not configured. Set ENCRYPTION_KEY env variable.", 500);
        }

        const connection = await getConnectionById(ctx.query.connectionId, encryptionKey);
        if (!connection) {
          ctx.set.status = 404;
          return notFoundResponse("Connection");
        }

        const isOwner =
          (connection.scope === "user" && connection.scopeId === userId) ||
          (connection.scope === "organization" && connection.scopeId === orgId);
        if (!isOwner) {
          ctx.set.status = 404;
          return notFoundResponse("Connection");
        }

        const credentials = connection.credentials as Record<string, unknown> | undefined;
        if (!credentials) {
          ctx.set.status = 400;
          return errorResponse("Connection has no credentials configured");
        }

        const config = (connection.config ?? {}) as Record<string, unknown>;
        const apiKey = credentials.apiKey as string;
        const host = ((credentials.host as string | undefined) ?? (config.host as string | undefined) ?? "https://app.posthog.com").replace(/\/+$/, "");
        const projectId = config.projectId as string | undefined;

        if (!projectId) {
          ctx.set.status = 400;
          return errorResponse(
            "PostHog connection is missing projectId in config. Update the connection settings.",
          );
        }

        const url = `${host}/api/projects/${projectId}/insights/`;
        const res = await fetchExternal(url, {
          Authorization: `Bearer ${apiKey}`,
        });

        if (!res.ok) {
          ctx.set.status = res.statusCode;
          return errorResponse(res.error, res.statusCode);
        }

        void updateConnectionLastUsedAt(connection.id);

        // PostHog wraps results in { results: [...] }
        const body = res.data as { results?: unknown[] };
        return successResponse(body.results ?? body);
      } catch (error) {
        logger.error(error, "Failed to fetch PostHog insights");
        ctx.set.status = 500;
        return errorResponse(
          error instanceof Error ? error.message : "Failed to fetch PostHog insights",
          500,
        );
      }
    },
    {
      query: t.Object({
        connectionId: t.String(),
      }),
    },
  )

  // -------------------------------------------------------------------
  // GET /observability/posthog/events?connectionId=X
  // -------------------------------------------------------------------
  .get(
    "/posthog/events",
    async (ctx) => {
      try {
        const userId = (ctx as unknown as { user: { id: string } }).user.id;
        const orgId = (ctx as unknown as { activeWorkspace: { id: string } }).activeWorkspace.id;

        const encryptionKey = env.ENCRYPTION_KEY;
        if (!encryptionKey) {
          ctx.set.status = 500;
          return errorResponse("Encryption key not configured. Set ENCRYPTION_KEY env variable.", 500);
        }

        const connection = await getConnectionById(ctx.query.connectionId, encryptionKey);
        if (!connection) {
          ctx.set.status = 404;
          return notFoundResponse("Connection");
        }

        const isOwner =
          (connection.scope === "user" && connection.scopeId === userId) ||
          (connection.scope === "organization" && connection.scopeId === orgId);
        if (!isOwner) {
          ctx.set.status = 404;
          return notFoundResponse("Connection");
        }

        const credentials = connection.credentials as Record<string, unknown> | undefined;
        if (!credentials) {
          ctx.set.status = 400;
          return errorResponse("Connection has no credentials configured");
        }

        const config = (connection.config ?? {}) as Record<string, unknown>;
        const apiKey = credentials.apiKey as string;
        const host = ((credentials.host as string | undefined) ?? (config.host as string | undefined) ?? "https://app.posthog.com").replace(/\/+$/, "");
        const projectId = config.projectId as string | undefined;

        if (!projectId) {
          ctx.set.status = 400;
          return errorResponse(
            "PostHog connection is missing projectId in config. Update the connection settings.",
          );
        }

        const url = `${host}/api/projects/${projectId}/events/?limit=20`;
        const res = await fetchExternal(url, {
          Authorization: `Bearer ${apiKey}`,
        });

        if (!res.ok) {
          ctx.set.status = res.statusCode;
          return errorResponse(res.error, res.statusCode);
        }

        void updateConnectionLastUsedAt(connection.id);

        // PostHog wraps results in { results: [...] }
        const body = res.data as { results?: unknown[] };
        return successResponse(body.results ?? body);
      } catch (error) {
        logger.error(error, "Failed to fetch PostHog events");
        ctx.set.status = 500;
        return errorResponse(
          error instanceof Error ? error.message : "Failed to fetch PostHog events",
          500,
        );
      }
    },
    {
      query: t.Object({
        connectionId: t.String(),
      }),
    },
  );

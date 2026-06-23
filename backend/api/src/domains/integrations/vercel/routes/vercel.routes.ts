import { Elysia, t } from "elysia";
import { sessionContextTypes } from "../../../../shared/middleware/session-context-types.plugin";
import {
  createVercelProviderConnection,
  getVercelConnectionByUser,
  deleteVercelConnectionByUser,
  decryptCredentials,
} from "@almirant/database";
import { env, logger } from "@almirant/config";
import {
  isVercelConfigured,
  getOAuthUrl,
  exchangeVercelCode,
  listVercelProjects,
  createVercelProject,
} from "../services/vercel-service";
import {
  successResponse,
  errorResponse,
} from "../../../../shared/services/response";

export const vercelRoutes = new Elysia({ prefix: "/vercel" })
  .use(sessionContextTypes)

  // ──────────────────────────────────────────────
  // Vercel Integration Status & OAuth
  // ──────────────────────────────────────────────

  // GET /vercel/status - Check if Vercel is configured + user's connection status
  .get("/status", async ({ user }) => {
    try {
      const userId = (user as { id: string }).id;
      const configured = isVercelConfigured();
      const connection = await getVercelConnectionByUser(userId);

      const config = connection ? (connection.config ?? {}) as Record<string, unknown> : null;

      return successResponse({
        configured,
        connected: !!connection,
        connection: connection
          ? {
              teamId: config?.teamId ?? null,
              teamName: config?.teamName ?? null,
              tokenPrefix: connection.accountIdentifier,
              scope: config?.scope ?? null,
            }
          : null,
      });
    } catch (error) {
      logger.error(error, "Failed to get Vercel status");
      return errorResponse(
        error instanceof Error ? error.message : "Failed to get Vercel status",
        500
      );
    }
  })

  // GET /vercel/auth-url - Generate OAuth URL with CSRF state param
  .get("/auth-url", async ({ set }) => {
    try {
      if (!isVercelConfigured()) {
        set.status = 400;
        return errorResponse(
          "Vercel is not configured (VERCEL_CLIENT_ID and VERCEL_CLIENT_SECRET required)"
        );
      }

      const state = crypto.randomUUID();
      const url = getOAuthUrl(state);

      return successResponse({ url, state });
    } catch (error) {
      logger.error(error, "Failed to generate Vercel auth URL");
      set.status = 500;
      return errorResponse(
        error instanceof Error
          ? error.message
          : "Failed to generate Vercel auth URL",
        500
      );
    }
  })

  // POST /vercel/callback - Exchange OAuth code for token, encrypt, save
  .post(
    "/callback",
    async ({ body, user, set }) => {
      try {
        if (!isVercelConfigured()) {
          set.status = 400;
          return errorResponse(
            "Vercel is not configured (VERCEL_CLIENT_ID and VERCEL_CLIENT_SECRET required)"
          );
        }

        const encryptionKey = env.ENCRYPTION_KEY;
        if (!encryptionKey) {
          set.status = 500;
          return errorResponse(
            "Encryption key not configured. Set ENCRYPTION_KEY env variable.",
            500
          );
        }

        const userId = (user as { id: string }).id;

        // Exchange code for access token
        const tokenResponse = await exchangeVercelCode(body.code);
        const accessToken = tokenResponse.access_token;

        const tokenPrefix = accessToken.slice(0, 8) + "...";

        // Remove existing connection if any
        await deleteVercelConnectionByUser(userId);

        // Create new connection
        const connection = await createVercelProviderConnection(
          {
            userId,
            teamId: tokenResponse.team_id ?? null,
            teamName: null,
            accessToken,
            tokenPrefix,
            scope: null,
          },
          encryptionKey
        );

        logger.info(
          { userId, teamId: tokenResponse.team_id ?? "personal" },
          "Vercel connection created successfully"
        );

        set.status = 201;
        return successResponse(connection);
      } catch (error) {
        logger.error(error, "Failed to process Vercel OAuth callback");
        set.status = 500;
        return errorResponse(
          error instanceof Error
            ? error.message
            : "Failed to process Vercel OAuth callback",
          500
        );
      }
    },
    {
      body: t.Object({
        code: t.String({ minLength: 1 }),
        state: t.String({ minLength: 1 }),
      }),
    }
  )

  // DELETE /vercel/connection - Disconnect Vercel (delete connection)
  .delete("/connection", async ({ user, set }) => {
    try {
      const userId = (user as { id: string }).id;
      const deleted = await deleteVercelConnectionByUser(userId);

      if (!deleted) {
        set.status = 404;
        return errorResponse("No Vercel connection found for this user", 404);
      }

      logger.info({ userId }, "Vercel connection deleted");
      return successResponse({ deleted: true });
    } catch (error) {
      logger.error(error, "Failed to delete Vercel connection");
      set.status = 500;
      return errorResponse(
        error instanceof Error
          ? error.message
          : "Failed to delete Vercel connection",
        500
      );
    }
  })

  // ──────────────────────────────────────────────
  // Vercel Project Proxies
  // ──────────────────────────────────────────────

  // GET /vercel/projects - List Vercel projects (proxy to Vercel API)
  .get("/projects", async ({ user, set }) => {
    try {
      const encryptionKey = env.ENCRYPTION_KEY;
      if (!encryptionKey) {
        set.status = 500;
        return errorResponse(
          "Encryption key not configured. Set ENCRYPTION_KEY env variable.",
          500
        );
      }

      const userId = (user as { id: string }).id;
      const connection = await getVercelConnectionByUser(userId);

      if (!connection) {
        set.status = 404;
        return errorResponse("No Vercel connection found. Please connect first.", 404);
      }

      const creds = decryptCredentials(connection, encryptionKey);
      const accessToken = creds.accessToken as string;
      const config = (connection.config ?? {}) as Record<string, unknown>;

      const projects = await listVercelProjects(
        accessToken,
        (config.teamId as string | undefined) ?? undefined
      );

      return successResponse(projects);
    } catch (error) {
      logger.error(error, "Failed to list Vercel projects");
      set.status = 500;
      return errorResponse(
        error instanceof Error
          ? error.message
          : "Failed to list Vercel projects",
        500
      );
    }
  })

  // POST /vercel/projects - Create a Vercel project (proxy to Vercel API)
  .post(
    "/projects",
    async ({ body, user, set }) => {
      try {
        const encryptionKey = env.ENCRYPTION_KEY;
        if (!encryptionKey) {
          set.status = 500;
          return errorResponse(
            "Encryption key not configured. Set ENCRYPTION_KEY env variable.",
            500
          );
        }

        const userId = (user as { id: string }).id;
        const connection = await getVercelConnectionByUser(userId);

        if (!connection) {
          set.status = 404;
          return errorResponse(
            "No Vercel connection found. Please connect first.",
            404
          );
        }

        const creds = decryptCredentials(connection, encryptionKey);
        const accessToken = creds.accessToken as string;
        const config = (connection.config ?? {}) as Record<string, unknown>;

        const gitRepository = body.gitRepository
          ? { type: "github" as const, repo: body.gitRepository.repo }
          : undefined;

        const project = await createVercelProject(
          accessToken,
          {
            name: body.name,
            framework: body.framework,
            gitRepository,
          },
          (config.teamId as string | undefined) ?? undefined
        );

        logger.info(
          { userId, projectName: body.name },
          "Vercel project created"
        );

        set.status = 201;
        return successResponse(project);
      } catch (error) {
        logger.error(error, "Failed to create Vercel project");
        set.status = 500;
        return errorResponse(
          error instanceof Error
            ? error.message
            : "Failed to create Vercel project",
          500
        );
      }
    },
    {
      body: t.Object({
        name: t.String({ minLength: 1 }),
        framework: t.Optional(t.String()),
        gitRepository: t.Optional(
          t.Object({
            repo: t.String(),
          })
        ),
      }),
    }
  );

import { Elysia, t } from "elysia";
import { sessionContextTypes } from "../../../../shared/middleware/session-context-types.plugin";
import {
  getDiscordConnectionByWorkspace,
  getDiscordConnectionById,
  createDiscordConnection,
  updateDiscordConnection,
  deleteDiscordConnection,
  getDiscordNotificationPreferences,
  upsertDiscordNotificationPreferences,
} from "@almirant/database";
import { env, logger } from "@almirant/config";
import { encrypt } from "../../../../shared/services/encryption";
import { getDiscordSlashCommands } from "../services/discord-commands";
import {
  successResponse,
  errorResponse,
  notFoundResponse,
} from "../../../../shared/services/response";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DISCORD_API_BASE = "https://discord.com/api/v10";
const DISCORD_OAUTH_SCOPES = "bot applications.commands guilds";
const DISCORD_BOT_PERMISSIONS = "2048"; // Send Messages (for slash commands)

// ---------------------------------------------------------------------------
// In-memory OAuth state store (short-lived, 10 min TTL)
// ---------------------------------------------------------------------------

const oauthStates = new Map<
  string,
  { workspaceId: string; expiresAt: number }
>();

/** Clean up expired states. */
const cleanExpiredStates = () => {
  const now = Date.now();
  for (const [key, value] of oauthStates) {
    if (value.expiresAt < now) {
      oauthStates.delete(key);
    }
  }
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Register slash commands in a guild using the bot token.
 */
const registerSlashCommandsInGuild = async (
  guildId: string,
): Promise<void> => {
  const appId = env.DISCORD_APPLICATION_ID;
  const botToken = env.DISCORD_BOT_TOKEN;

  if (!appId || !botToken) {
    logger.warn(
      "DISCORD_APPLICATION_ID or DISCORD_BOT_TOKEN not configured, skipping slash command registration",
    );
    return;
  }

  const commands = getDiscordSlashCommands();

  const res = await fetch(
    `${DISCORD_API_BASE}/applications/${appId}/guilds/${guildId}/commands`,
    {
      method: "PUT",
      headers: {
        Authorization: `Bot ${botToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(commands),
    },
  );

  if (!res.ok) {
    const errorBody = await res.text().catch(() => "");
    logger.error(
      { status: res.status, body: errorBody, guildId },
      "Failed to register Discord slash commands in guild",
    );
    throw new Error(
      `Failed to register slash commands: Discord returned ${res.status}`,
    );
  }

  logger.info({ guildId, commandCount: commands.length }, "Registered Discord slash commands in guild");
};

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

export const discordOauthRoutes = new Elysia({
  prefix: "/integrations/discord",
})
  .use(sessionContextTypes)

  // -------------------------------------------------------
  // GET /authorize - Generate Discord OAuth2 URL
  // -------------------------------------------------------
  .get("/authorize", async ({ activeWorkspace, set }) => {
    try {
      const clientId = env.DISCORD_CLIENT_ID;
      const redirectUri = env.DISCORD_OAUTH_REDIRECT_URI;

      if (!clientId || !redirectUri) {
        set.status = 500;
        return errorResponse(
          "Discord OAuth not configured. Set DISCORD_CLIENT_ID and DISCORD_OAUTH_REDIRECT_URI.",
          500,
        );
      }

      const orgId = (activeWorkspace as { id: string }).id;

      // Generate state token
      const state = crypto.randomUUID();
      oauthStates.set(state, {
        workspaceId: orgId,
        expiresAt: Date.now() + 10 * 60 * 1000, // 10 minutes
      });

      // Clean up expired states in the background
      cleanExpiredStates();

      const params = new URLSearchParams({
        client_id: clientId,
        redirect_uri: redirectUri,
        response_type: "code",
        scope: DISCORD_OAUTH_SCOPES,
        state,
        permissions: DISCORD_BOT_PERMISSIONS,
      });

      const url = `https://discord.com/oauth2/authorize?${params.toString()}`;

      return successResponse({ url });
    } catch (error) {
      logger.error(error, "Failed to generate Discord OAuth URL");
      set.status = 500;
      return errorResponse(
        error instanceof Error
          ? error.message
          : "Failed to generate Discord OAuth URL",
        500,
      );
    }
  })

  // -------------------------------------------------------
  // GET /callback - Handle OAuth callback
  // -------------------------------------------------------
  .get(
    "/callback",
    async ({ query, set }) => {
      try {
        const { code, state } = query;

        if (!code || !state) {
          set.status = 400;
          return errorResponse("Missing code or state parameter");
        }

        // Verify state
        const storedState = oauthStates.get(state);
        if (!storedState || storedState.expiresAt < Date.now()) {
          oauthStates.delete(state);
          set.status = 400;
          return errorResponse(
            "Invalid or expired OAuth state. Please try again.",
          );
        }

        const { workspaceId } = storedState;
        oauthStates.delete(state);

        const clientId = env.DISCORD_CLIENT_ID;
        const clientSecret = env.DISCORD_CLIENT_SECRET;
        const redirectUri = env.DISCORD_OAUTH_REDIRECT_URI;

        if (!clientId || !clientSecret || !redirectUri) {
          set.status = 500;
          return errorResponse(
            "Discord OAuth not fully configured. Set DISCORD_CLIENT_ID, DISCORD_CLIENT_SECRET, and DISCORD_OAUTH_REDIRECT_URI.",
            500,
          );
        }

        // Exchange code for token
        const tokenRes = await fetch(`${DISCORD_API_BASE}/oauth2/token`, {
          method: "POST",
          headers: {
            "Content-Type": "application/x-www-form-urlencoded",
          },
          body: new URLSearchParams({
            client_id: clientId,
            client_secret: clientSecret,
            grant_type: "authorization_code",
            code,
            redirect_uri: redirectUri,
          }),
        });

        if (!tokenRes.ok) {
          const errorBody = await tokenRes.text().catch(() => "");
          logger.error(
            { status: tokenRes.status, body: errorBody },
            "Discord OAuth token exchange failed",
          );
          set.status = 502;
          return errorResponse(
            `Discord token exchange failed: ${tokenRes.status}`,
            502,
          );
        }

        const tokenData = (await tokenRes.json()) as {
          access_token: string;
          token_type: string;
          expires_in?: number;
          refresh_token?: string;
          scope: string;
          guild?: {
            id: string;
            name: string;
          };
        };

        const guild = tokenData.guild;
        if (!guild) {
          set.status = 400;
          return errorResponse(
            "No guild information received from Discord. Make sure you select a server during authorization.",
          );
        }

        // Encrypt tokens
        const encryptionKey = env.ENCRYPTION_KEY;
        let encryptedAccess:
          | { encrypted: string; iv: string; authTag: string }
          | undefined;
        let encryptedRefresh:
          | { encrypted: string; iv: string; authTag: string }
          | undefined;

        if (encryptionKey) {
          encryptedAccess = encrypt(tokenData.access_token, encryptionKey);
          if (tokenData.refresh_token) {
            encryptedRefresh = encrypt(
              tokenData.refresh_token,
              encryptionKey,
            );
          }
        }

        // Create connection record
        const connection = await createDiscordConnection({
          workspaceId,
          guildId: guild.id,
          guildName: guild.name,
          encryptedAccessToken: encryptedAccess?.encrypted ?? null,
          accessTokenIv: encryptedAccess?.iv ?? null,
          accessTokenAuthTag: encryptedAccess?.authTag ?? null,
          encryptedRefreshToken: encryptedRefresh?.encrypted ?? null,
          refreshTokenIv: encryptedRefresh?.iv ?? null,
          refreshTokenAuthTag: encryptedRefresh?.authTag ?? null,
          botJoinedAt: new Date(),
          isActive: true,
        });

        // Register slash commands in the guild (best-effort)
        try {
          await registerSlashCommandsInGuild(guild.id);
        } catch (err) {
          logger.warn(
            { err, guildId: guild.id },
            "Slash command registration failed during OAuth callback, connection was still created",
          );
        }

        logger.info(
          {
            workspaceId,
            guildId: guild.id,
            guildName: guild.name,
            connectionId: connection.id,
          },
          "Discord OAuth connection created successfully",
        );

        return successResponse({
          id: connection.id,
          guildId: connection.guildId,
          guildName: connection.guildName,
          isActive: connection.isActive,
          botJoinedAt: connection.botJoinedAt,
        });
      } catch (error) {
        logger.error(error, "Failed to process Discord OAuth callback");
        set.status = 500;
        return errorResponse(
          error instanceof Error
            ? error.message
            : "Failed to process Discord OAuth callback",
          500,
        );
      }
    },
    {
      query: t.Object({
        code: t.Optional(t.String()),
        state: t.Optional(t.String()),
      }),
    },
  )

  // -------------------------------------------------------
  // GET /connection - Get current org's Discord connection
  // -------------------------------------------------------
  .get("/connection", async ({ activeWorkspace, set }) => {
    try {
      const orgId = (activeWorkspace as { id: string }).id;

      const connection = await getDiscordConnectionByWorkspace(orgId);

      if (!connection) {
        return successResponse(null);
      }

      // Return connection without decrypted tokens
      return successResponse({
        id: connection.id,
        workspaceId: connection.workspaceId,
        guildId: connection.guildId,
        guildName: connection.guildName,
        defaultChannelId: connection.defaultChannelId,
        defaultChannelName: connection.defaultChannelName,
        botJoinedAt: connection.botJoinedAt,
        isActive: connection.isActive,
        createdAt: connection.createdAt,
        updatedAt: connection.updatedAt,
      });
    } catch (error) {
      logger.error(error, "Failed to get Discord connection");
      set.status = 500;
      return errorResponse(
        error instanceof Error
          ? error.message
          : "Failed to get Discord connection",
        500,
      );
    }
  })

  // -------------------------------------------------------
  // GET /channels - List channels from connected guild
  // -------------------------------------------------------
  .get("/channels", async ({ activeWorkspace, set }) => {
    try {
      const orgId = (activeWorkspace as { id: string }).id;
      const botToken = env.DISCORD_BOT_TOKEN;

      if (!botToken) {
        set.status = 500;
        return errorResponse(
          "DISCORD_BOT_TOKEN not configured",
          500,
        );
      }

      const connection = await getDiscordConnectionByWorkspace(orgId);

      if (!connection) {
        set.status = 404;
        return notFoundResponse("Discord connection");
      }

      const res = await fetch(
        `${DISCORD_API_BASE}/guilds/${connection.guildId}/channels`,
        {
          headers: {
            Authorization: `Bot ${botToken}`,
          },
        },
      );

      if (!res.ok) {
        const errorBody = await res.text().catch(() => "");
        logger.error(
          {
            status: res.status,
            body: errorBody,
            guildId: connection.guildId,
          },
          "Failed to fetch Discord guild channels",
        );
        set.status = 502;
        return errorResponse(
          `Failed to fetch channels from Discord: ${res.status}`,
          502,
        );
      }

      const channels = (await res.json()) as Array<{
        id: string;
        name: string;
        type: number;
        position: number;
        parent_id: string | null;
      }>;

      // Filter to text channels (type 0) and category channels (type 4)
      const filtered = channels
        .filter((ch) => ch.type === 0 || ch.type === 4)
        .map((ch) => ({
          id: ch.id,
          name: ch.name,
          type: ch.type === 0 ? "text" : "category",
          position: ch.position,
          parentId: ch.parent_id,
        }))
        .sort((a, b) => a.position - b.position);

      return successResponse(filtered);
    } catch (error) {
      logger.error(error, "Failed to list Discord channels");
      set.status = 500;
      return errorResponse(
        error instanceof Error
          ? error.message
          : "Failed to list Discord channels",
        500,
      );
    }
  })

  // -------------------------------------------------------
  // PATCH /:connectionId - Update default channel
  // -------------------------------------------------------
  .patch(
    "/:connectionId",
    async ({ params, body, activeWorkspace, set }) => {
      try {
        const orgId = (activeWorkspace as { id: string }).id;

        const connection = await getDiscordConnectionById(params.connectionId, orgId);

        if (!connection) {
          set.status = 404;
          return notFoundResponse("Discord connection");
        }

        const updated = await updateDiscordConnection(params.connectionId, orgId, {
          defaultChannelId: body.defaultChannelId,
          defaultChannelName: body.defaultChannelName,
        });

        if (!updated) {
          set.status = 404;
          return notFoundResponse("Discord connection");
        }

        return successResponse({
          id: updated.id,
          guildId: updated.guildId,
          guildName: updated.guildName,
          defaultChannelId: updated.defaultChannelId,
          defaultChannelName: updated.defaultChannelName,
          isActive: updated.isActive,
        });
      } catch (error) {
        logger.error(error, "Failed to update Discord connection");
        set.status = 500;
        return errorResponse(
          error instanceof Error
            ? error.message
            : "Failed to update Discord connection",
          500,
        );
      }
    },
    {
      params: t.Object({
        connectionId: t.String(),
      }),
      body: t.Object({
        defaultChannelId: t.Optional(t.String()),
        defaultChannelName: t.Optional(t.String()),
      }),
    },
  )

  // -------------------------------------------------------
  // DELETE /:connectionId - Disconnect
  // -------------------------------------------------------
  .delete(
    "/:connectionId",
    async ({ params, activeWorkspace, set }) => {
      try {
        const orgId = (activeWorkspace as { id: string }).id;

        const connection = await getDiscordConnectionById(params.connectionId, orgId);

        if (!connection) {
          set.status = 404;
          return notFoundResponse("Discord connection");
        }

        const deleted = await deleteDiscordConnection(params.connectionId, orgId);

        if (!deleted) {
          set.status = 404;
          return notFoundResponse("Discord connection");
        }

        logger.info(
          {
            workspaceId: orgId,
            guildId: connection.guildId,
            connectionId: params.connectionId,
          },
          "Discord connection deleted",
        );

        return successResponse({ deleted: true });
      } catch (error) {
        logger.error(error, "Failed to delete Discord connection");
        set.status = 500;
        return errorResponse(
          error instanceof Error
            ? error.message
            : "Failed to delete Discord connection",
          500,
        );
      }
    },
    {
      params: t.Object({
        connectionId: t.String(),
      }),
    },
  )

  // -------------------------------------------------------
  // POST /:connectionId/test - Send a test message
  // -------------------------------------------------------
  .post(
    "/:connectionId/test",
    async ({ params, body, activeWorkspace, set }) => {
      try {
        const orgId = (activeWorkspace as { id: string }).id;

        const connection = await getDiscordConnectionById(params.connectionId, orgId);

        if (!connection) {
          set.status = 404;
          return notFoundResponse("Discord connection");
        }

        const botToken = env.DISCORD_BOT_TOKEN;
        if (!botToken) {
          set.status = 500;
          return errorResponse("DISCORD_BOT_TOKEN not configured", 500);
        }

        const channelId = body.channelId ?? connection.defaultChannelId;

        if (!channelId) {
          set.status = 400;
          return errorResponse(
            "No channel specified and no default channel configured for this connection",
          );
        }

        const res = await fetch(
          `${DISCORD_API_BASE}/channels/${channelId}/messages`,
          {
            method: "POST",
            headers: {
              Authorization: `Bot ${botToken}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              embeds: [
                {
                  title: "\u2705 Almirant Discord Integration Test",
                  description:
                    "This is a test message from Almirant. Your Discord integration is working correctly!",
                  color: 5763719,
                  footer: { text: "Connected via Almirant" },
                  timestamp: new Date().toISOString(),
                },
              ],
            }),
          },
        );

        if (!res.ok) {
          const errorBody = await res.text().catch(() => "");

          if (res.status === 429) {
            logger.warn(
              { status: res.status, body: errorBody, channelId },
              "Discord API rate limit hit while sending test message",
            );
            set.status = 502;
            return successResponse({
              sent: false,
              error: "Discord rate limit exceeded. Please try again in a few seconds.",
            });
          }

          logger.error(
            { status: res.status, body: errorBody, channelId, guildId: connection.guildId },
            "Failed to send Discord test message",
          );
          set.status = 502;
          return successResponse({
            sent: false,
            error: `Failed to send message to Discord: ${res.status}`,
          });
        }

        const messageData = (await res.json()) as { id: string };

        logger.info(
          {
            connectionId: params.connectionId,
            channelId,
            messageId: messageData.id,
          },
          "Discord test message sent successfully",
        );

        return successResponse({
          sent: true,
          messageId: messageData.id,
        });
      } catch (error) {
        logger.error(error, "Failed to send Discord test message");
        set.status = 500;
        return errorResponse(
          error instanceof Error
            ? error.message
            : "Failed to send Discord test message",
          500,
        );
      }
    },
    {
      params: t.Object({
        connectionId: t.String(),
      }),
      body: t.Object({
        channelId: t.Optional(t.String()),
      }),
    },
  )

  // -------------------------------------------------------
  // GET /:connectionId/notifications - Get org-level notification prefs
  // -------------------------------------------------------
  .get(
    "/:connectionId/notifications",
    async ({ params, activeWorkspace, set }) => {
      try {
        const orgId = (activeWorkspace as { id: string }).id;

        const connection = await getDiscordConnectionById(params.connectionId, orgId);
        if (!connection) {
          set.status = 404;
          return notFoundResponse("Discord connection");
        }

        const prefs = await getDiscordNotificationPreferences(
          params.connectionId,
          null,
        );

        const DEFAULT_NOTIFICATION_PREFS = {
          enabled: true,
          notifyWorkItemCreated: true,
          notifyWorkItemMoved: true,
          notifyWorkItemAssigned: true,
          notifyWorkItemDone: true,
          notifyWorkItemComment: true,
          notifyWorkItemUpdated: false,
          notifyWorkItemDeleted: false,
          notifyCommentAdded: false,
          notifyAttachmentAdded: false,
          notifySprintStarted: true,
          notifySprintClosed: true,
          notifyMilestoneCompleted: true,
          notifyPrOpened: true,
          notifyPrMerged: true,
          notifyCiFailed: true,
          notifyAgentJobCompleted: true,
          notifyAgentJobFailed: true,
          notifySeedPromoted: true,
        };

        return successResponse(prefs ?? DEFAULT_NOTIFICATION_PREFS);
      } catch (error) {
        logger.error(error, "Failed to get Discord notification preferences");
        set.status = 500;
        return errorResponse(
          error instanceof Error
            ? error.message
            : "Failed to get Discord notification preferences",
          500,
        );
      }
    },
    {
      params: t.Object({
        connectionId: t.String(),
      }),
    },
  )

  // -------------------------------------------------------
  // PATCH /:connectionId/notifications - Upsert org-level notification prefs
  // -------------------------------------------------------
  .patch(
    "/:connectionId/notifications",
    async ({ params, body, activeWorkspace, set }) => {
      try {
        const orgId = (activeWorkspace as { id: string }).id;

        const connection = await getDiscordConnectionById(params.connectionId, orgId);
        if (!connection) {
          set.status = 404;
          return notFoundResponse("Discord connection");
        }

        const upserted = await upsertDiscordNotificationPreferences({
          discordConnectionId: params.connectionId,
          projectId: null,
          ...body,
        });

        return successResponse(upserted);
      } catch (error) {
        logger.error(error, "Failed to update Discord notification preferences");
        set.status = 500;
        return errorResponse(
          error instanceof Error
            ? error.message
            : "Failed to update Discord notification preferences",
          500,
        );
      }
    },
    {
      params: t.Object({
        connectionId: t.String(),
      }),
      body: t.Object({
        enabled: t.Optional(t.Boolean()),
        notifyWorkItemCreated: t.Optional(t.Boolean()),
        notifyWorkItemMoved: t.Optional(t.Boolean()),
        notifyWorkItemAssigned: t.Optional(t.Boolean()),
        notifyWorkItemDone: t.Optional(t.Boolean()),
        notifyWorkItemComment: t.Optional(t.Boolean()),
        notifyWorkItemUpdated: t.Optional(t.Boolean()),
        notifyWorkItemDeleted: t.Optional(t.Boolean()),
        notifyCommentAdded: t.Optional(t.Boolean()),
        notifyAttachmentAdded: t.Optional(t.Boolean()),
        notifySprintStarted: t.Optional(t.Boolean()),
        notifySprintClosed: t.Optional(t.Boolean()),
        notifyMilestoneCompleted: t.Optional(t.Boolean()),
        notifyPrOpened: t.Optional(t.Boolean()),
        notifyPrMerged: t.Optional(t.Boolean()),
        notifyCiFailed: t.Optional(t.Boolean()),
        notifyAgentJobCompleted: t.Optional(t.Boolean()),
        notifyAgentJobFailed: t.Optional(t.Boolean()),
        notifySeedPromoted: t.Optional(t.Boolean()),
      }),
    },
  );

import { Elysia, t } from "elysia";
import { logger } from "@almirant/config";
import { validateWsToken } from "./ws-auth";
import { wsConnectionManager } from "./ws-connection-manager";
import { routeMessage } from "./ws-message-router";
import type { WsClientMessage } from "./ws-types";

type WsUser = { id: string; name: string; email: string };

// Elysia 1.4 creates a new ws wrapper per event, so we can't use the ws object
// as a Map key. Instead we store the user on ws.data (persists across events)
// and use ws.raw for the connection manager (stable reference).
type WsData = {
  query: { token: string };
  user?: WsUser;
  organizationId?: string | null;
  /** Messages received before auth completes — replayed after validation. */
  pendingMessages?: unknown[];
  /** Set to true once authentication completes (success or failure). */
  authResolved?: boolean;
};

/** Process a single WS message after authentication is confirmed. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const processMessage = (ws: any, message: unknown, data: WsData) => {
  const user = data.user;
  if (!user) return; // Should never happen after auth

  try {
    const parsed: WsClientMessage =
      typeof message === "string"
        ? JSON.parse(message)
        : (message as WsClientMessage);

    if (parsed.type !== "ping") {
      logger.info(`[WS] <- ${parsed.type} from ${user.name}`);
    }

    const organizationId = data.organizationId ?? null;
    routeMessage(user.id, organizationId, parsed, (msg) => {
      if (msg.type !== "pong") {
        logger.info(`[WS] -> ${msg.type} to ${user.name}`);
      }
      ws.send(JSON.stringify(msg));
    });
  } catch (err) {
    logger.error({ err }, `[WS] Failed to parse message from ${user.name}`);
  }
};

export const wsHandler = new Elysia({ name: "ws-handler" }).ws("/ws", {
  query: t.Object({
    token: t.String(),
  }),
  body: t.Any(),

  // IMPORTANT: This handler MUST be synchronous (not async).
  // Elysia 1.4 + Bun 1.3 silently swallows the entire open handler when
  // it's declared `async` inside a Docker container — the WS upgrade succeeds
  // (101) but no handler code ever executes. Using a sync handler with
  // `.then()` for the async DB call works reliably across all environments.
  open(ws) {
    const data = ws.data as WsData;
    const token = data.query.token;

    if (!token) {
      logger.warn("[WS] Connection rejected: no token provided");
      ws.close(4001, "No token");
      return;
    }

    validateWsToken(token).then((result) => {
      if (!result) {
        logger.warn("[WS] Connection rejected: invalid token");
        data.authResolved = true;
        ws.close(4001, "Unauthorized");
        return;
      }

      const { user, organizationId } = result;
      data.user = user;
      data.organizationId = organizationId;
      data.authResolved = true;
      wsConnectionManager.addConnection(user.id, ws.raw, organizationId);
      const total = wsConnectionManager.getConnectionCount();
      logger.info(`[WS] User ${user.name} connected (${total} total connections)`);

      // Replay any messages that arrived during authentication
      if (data.pendingMessages && data.pendingMessages.length > 0) {
        const pending = data.pendingMessages;
        data.pendingMessages = [];
        logger.info(`[WS] Replaying ${pending.length} queued message(s) for ${user.name}`);
        for (const msg of pending) {
          processMessage(ws, msg, data);
        }
      }
    }).catch((err) => {
      logger.error({ err }, "[WS] Error validating token");
      data.authResolved = true;
      ws.close(4002, "Validation error");
    });
  },

  message(ws, message) {
    const data = ws.data as WsData;

    // If auth hasn't resolved yet, queue the message for replay
    if (!data.authResolved) {
      if (!data.pendingMessages) data.pendingMessages = [];
      data.pendingMessages.push(message);
      return;
    }

    // Update activity timestamp on every received message
    wsConnectionManager.updateActivity(ws.raw);

    processMessage(ws, message, data);
  },

  close(ws) {
    const user = (ws.data as WsData).user;
    if (user) {
      wsConnectionManager.removeConnection(user.id, ws.raw);
      const total = wsConnectionManager.getConnectionCount();
      logger.info(`[WS] User ${user.name} disconnected (${total} total connections)`);
    }
  },
});

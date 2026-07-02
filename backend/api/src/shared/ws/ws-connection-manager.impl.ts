import Redis from "ioredis";
import * as config from "@almirant/config";
import type { WsServerMessage } from "./ws-types";

/** How often the sweep runs (ms). */
const SWEEP_INTERVAL_MS = 30_000;

/** If a connection has been awaiting a pong for longer than this, it is stale. */
const STALE_THRESHOLD_MS = 40_000; // 30s ping interval + 10s grace

export interface WsConnection {
  send: (data: string | Buffer) => void;
  close?: () => void;
}

export interface WsConnectionEntry {
  ws: WsConnection;
  workspaceId: string | null;
  lastActivity: number;
  awaitingPong: boolean;
}

type WsPubSubEnvelope = {
  workspaceId: string;
  message: WsServerMessage;
  originInstanceId?: string;
};

type WsLogger = {
  error: (...args: unknown[]) => void;
  info: (...args: unknown[]) => void;
  warn: (...args: unknown[]) => void;
  debug: (...args: unknown[]) => void;
};

type WsEnv = {
  REDIS_URL?: string | null;
  WS_PUBSUB_CHANNEL: string;
};

type RedisPublisher = {
  on: (event: string, handler: (...args: unknown[]) => void) => unknown;
  publish: (channel: string, payload: string) => Promise<unknown>;
  quit: () => Promise<unknown>;
};

type RedisPublisherCtor = new (url: string) => RedisPublisher;

const defaultEnv: WsEnv = config.env ?? {
  REDIS_URL: process.env.REDIS_URL,
  WS_PUBSUB_CHANNEL: process.env.WS_PUBSUB_CHANNEL ?? "ws:broadcast",
};

const defaultLogger: WsLogger = config.logger ?? {
  error: () => {},
  info: () => {},
  warn: () => {},
  debug: () => {},
};

const defaultInstanceId = process.env.HOSTNAME?.trim() || crypto.randomUUID();

export const createWsConnectionManager = (deps?: {
  RedisClass?: RedisPublisherCtor;
  env?: WsEnv;
  logger?: WsLogger;
  instanceId?: string;
}) => {
  const RedisClass = deps?.RedisClass ?? (Redis as unknown as RedisPublisherCtor);
  const env = deps?.env ?? defaultEnv;
  const logger = deps?.logger ?? defaultLogger;
  const instanceId = deps?.instanceId ?? defaultInstanceId;

  const connections = new Map<string, Set<WsConnectionEntry>>();
  let sweepIntervalId: ReturnType<typeof setInterval> | null = null;
  let pubSubPublisher: RedisPublisher | null | undefined;

  const removeEntry = (userId: string, entry: WsConnectionEntry) => {
    const userConnections = connections.get(userId);
    if (!userConnections) return;
    userConnections.delete(entry);
    if (userConnections.size === 0) {
      connections.delete(userId);
    }
  };

  const getPubSubPublisher = (): RedisPublisher | null => {
    if (pubSubPublisher !== undefined) {
      return pubSubPublisher;
    }

    if (!env.REDIS_URL) {
      pubSubPublisher = null;
      return pubSubPublisher;
    }

    const redis = new RedisClass(env.REDIS_URL);
    redis.on("error", (err) => {
      logger.error({ err }, "Redis WS publisher connection error");
    });
    pubSubPublisher = redis;
    return pubSubPublisher;
  };

  const broadcastLocallyToWorkspace = (
    workspaceId: string,
    message: WsServerMessage
  ) => {
    const payload = JSON.stringify(message);
    for (const [userId, userConnections] of connections) {
      for (const entry of userConnections) {
        if (entry.workspaceId !== workspaceId) continue;
        try {
          entry.ws.send(payload);
        } catch (err) {
          logger.error(
            { userId, workspaceId, err },
            "Failed to broadcast WS message to workspace"
          );
        }
      }
    }
  };

  const wsConnectionManager = {
    addConnection: (
      userId: string,
      ws: WsConnection,
      workspaceId: string | null = null
    ) => {
      let userConnections = connections.get(userId);
      if (!userConnections) {
        userConnections = new Set();
        connections.set(userId, userConnections);
      }
      userConnections.add({
        ws,
        workspaceId,
        lastActivity: Date.now(),
        awaitingPong: false,
      });
      logger.debug(
        {
          userId,
          workspaceId,
          totalConnections: wsConnectionManager.getConnectionCount(),
        },
        "WS connection added"
      );
    },

    removeConnection: (userId: string, ws: WsConnection) => {
      const userConnections = connections.get(userId);
      if (!userConnections) return;

      for (const entry of userConnections) {
        if (entry.ws === ws) {
          userConnections.delete(entry);
          break;
        }
      }

      if (userConnections.size === 0) {
        connections.delete(userId);
      }
      logger.debug(
        { userId, totalConnections: wsConnectionManager.getConnectionCount() },
        "WS connection removed"
      );
    },

    updateActivity: (ws: WsConnection) => {
      for (const userConnections of connections.values()) {
        for (const entry of userConnections) {
          if (entry.ws === ws) {
            entry.lastActivity = Date.now();
            entry.awaitingPong = false;
            return;
          }
        }
      }
    },

    sendToUser: (userId: string, message: WsServerMessage) => {
      const userConnections = connections.get(userId);
      if (!userConnections || userConnections.size === 0) return;

      const payload = JSON.stringify(message);
      for (const entry of userConnections) {
        try {
          entry.ws.send(payload);
        } catch (err) {
          logger.error({ userId, err }, "Failed to send WS message to user");
        }
      }
    },

    broadcastToWorkspace: (
      workspaceId: string,
      message: WsServerMessage
    ) => {
      broadcastLocallyToWorkspace(workspaceId, message);

      const redis = getPubSubPublisher();
      if (!redis) return;

      const payload = JSON.stringify({
        workspaceId,
        message,
        originInstanceId: instanceId,
      } satisfies WsPubSubEnvelope);

      void redis.publish(env.WS_PUBSUB_CHANNEL, payload).catch((err) => {
        logger.error(
          { workspaceId, err, channel: env.WS_PUBSUB_CHANNEL },
          "Failed to publish WS message to Redis Pub/Sub"
        );
      });
    },

    broadcastLocallyToWorkspace,

    getInstanceId: (): string => instanceId,

    getConnectionCount: (): number => {
      let total = 0;
      for (const userConnections of connections.values()) {
        total += userConnections.size;
      }
      return total;
    },

    getUserCount: (): number => connections.size,

    getStaleConnectionCount: (): number => {
      let count = 0;
      for (const userConnections of connections.values()) {
        for (const entry of userConnections) {
          if (entry.awaitingPong) count++;
        }
      }
      return count;
    },

    /**
     * Start a periodic sweep that sends application-level pings and removes
     * connections that failed to respond within the stale threshold.
     */
    startSweepInterval: () => {
      if (sweepIntervalId !== null) return;

      const pingPayload = JSON.stringify({ type: "ping" });

      sweepIntervalId = setInterval(() => {
        const now = Date.now();
        const staleEntries: Array<{ userId: string; entry: WsConnectionEntry }> = [];

        for (const [userId, userConnections] of connections) {
          for (const entry of userConnections) {
            if (entry.awaitingPong && now - entry.lastActivity > STALE_THRESHOLD_MS) {
              staleEntries.push({ userId, entry });
            }
          }
        }

        for (const { userId, entry } of staleEntries) {
          try {
            entry.ws.close?.();
          } catch {
            // Connection may already be dead, ignore
          }
          removeEntry(userId, entry);
          logger.info(
            {
              userId,
              workspaceId: entry.workspaceId,
              staleSinceMs: now - entry.lastActivity,
              totalConnections: wsConnectionManager.getConnectionCount(),
            },
            "Removed stale WS connection (no pong received)"
          );
        }

        for (const [userId, userConnections] of connections) {
          for (const entry of userConnections) {
            try {
              entry.ws.send(pingPayload);
              entry.awaitingPong = true;
            } catch {
              removeEntry(userId, entry);
              logger.info(
                {
                  userId,
                  workspaceId: entry.workspaceId,
                  totalConnections: wsConnectionManager.getConnectionCount(),
                },
                "Removed dead WS connection (send failed)"
              );
            }
          }
        }
      }, SWEEP_INTERVAL_MS);

      logger.info(
        { intervalMs: SWEEP_INTERVAL_MS, staleThresholdMs: STALE_THRESHOLD_MS },
        "WS connection sweep interval started"
      );
    },

    stopSweepInterval: () => {
      if (sweepIntervalId !== null) {
        clearInterval(sweepIntervalId);
        sweepIntervalId = null;
        logger.info("WS connection sweep interval stopped");
      }
    },

    stopPubSubPublisher: async () => {
      if (!pubSubPublisher) return;
      await pubSubPublisher.quit();
      pubSubPublisher = null;
      logger.info("WS Pub/Sub publisher stopped");
    },
  };

  return wsConnectionManager;
};

export const wsConnectionManager = createWsConnectionManager();

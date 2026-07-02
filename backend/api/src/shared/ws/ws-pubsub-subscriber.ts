import Redis from "ioredis";
import { logger } from "@almirant/config";
import { wsConnectionManager } from "./ws-connection-manager";
import type { WsServerMessage } from "./ws-types";

type PubSubMessage = {
  workspaceId: string;
  message: WsServerMessage;
  originInstanceId?: string;
};

export const startWsPubSubSubscriber = (config: {
  redisUrl: string;
  channel: string;
}): (() => Promise<void>) => {
  const redis = new Redis(config.redisUrl);

  redis.subscribe(config.channel, (err) => {
    if (err) {
      logger.error(
        { err, channel: config.channel },
        "Failed to subscribe to WS Pub/Sub channel"
      );
      return;
    }
    logger.info(
      { channel: config.channel },
      "Subscribed to WS Pub/Sub channel"
    );
  });

  redis.on("message", (channel, rawMessage) => {
    try {
      const parsed: PubSubMessage = JSON.parse(rawMessage);
      if (!parsed.workspaceId || !parsed.message) {
        logger.warn(
          { channel },
          "Invalid WS Pub/Sub message: missing workspaceId or message"
        );
        return;
      }

      if (
        parsed.originInstanceId &&
        parsed.originInstanceId === wsConnectionManager.getInstanceId()
      ) {
        return;
      }

      wsConnectionManager.broadcastLocallyToWorkspace(
        parsed.workspaceId,
        parsed.message
      );
    } catch (err) {
      logger.error({ err, channel }, "Failed to parse WS Pub/Sub message");
    }
  });

  redis.on("error", (err) => {
    logger.error({ err }, "Redis Pub/Sub connection error");
  });

  // Return stop function
  return async () => {
    await redis.unsubscribe(config.channel);
    await redis.quit();
    logger.info(
      { channel: config.channel },
      "Unsubscribed from WS Pub/Sub channel"
    );
  };
};

import { PostHog } from "posthog-node";
import { env, logger } from "@almirant/config";

let client: PostHog | null = null;

const getClient = (): PostHog | null => {
  if (!env.POSTHOG_API_KEY) return null;
  if (!client) {
    client = new PostHog(env.POSTHOG_API_KEY, {
      host: env.POSTHOG_HOST,
      flushAt: 10,
      flushInterval: 5000,
    });
  }
  return client;
};

export const isPostHogConfigured = (): boolean => !!env.POSTHOG_API_KEY;

export const captureServerEvent = (
  distinctId: string,
  event: string,
  properties?: Record<string, unknown>
): void => {
  const ph = getClient();
  if (!ph) return;

  try {
    ph.capture({
      distinctId,
      event,
      properties: {
        ...properties,
        $lib: "posthog-node",
        source: "backend",
      },
    });
  } catch (error) {
    logger.warn({ error, event }, "PostHog server capture failed");
  }
};

export const identifyUser = (
  distinctId: string,
  properties: Record<string, unknown>
): void => {
  const ph = getClient();
  if (!ph) return;

  try {
    ph.identify({
      distinctId,
      properties,
    });
  } catch (error) {
    logger.warn({ error, distinctId }, "PostHog server identify failed");
  }
};

export const shutdownPostHog = async (): Promise<void> => {
  if (client) {
    await client.shutdown();
    client = null;
  }
};

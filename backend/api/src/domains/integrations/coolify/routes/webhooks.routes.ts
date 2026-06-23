import { Elysia } from "elysia";
import { createHmac, timingSafeEqual } from "crypto";
import { env, logger } from "@almirant/config";
import { handleCoolifyDeployment } from "../services/coolify-webhook-handlers";

/**
 * Verify the HMAC SHA-256 signature from Coolify.
 *
 * Unlike the Vercel webhook handler which skips verification when the secret
 * is not configured, this handler REJECTS requests if COOLIFY_WEBHOOK_SECRET
 * is not set. This prevents accidental exposure of the endpoint without proper
 * authentication.
 *
 * Uses timing-safe comparison to prevent timing attacks.
 */
const verifyCoolifySignature = (
  rawBody: string,
  signature: string
): boolean => {
  try {
    if (!env.COOLIFY_WEBHOOK_SECRET) {
      logger.error(
        "COOLIFY_WEBHOOK_SECRET is not configured, rejecting webhook"
      );
      return false;
    }

    if (!signature) {
      return false;
    }

    const expected = createHmac("sha256", env.COOLIFY_WEBHOOK_SECRET)
      .update(rawBody, "utf-8")
      .digest("hex");

    if (expected.length !== signature.length) {
      return false;
    }

    return timingSafeEqual(
      Buffer.from(expected, "utf-8"),
      Buffer.from(signature, "utf-8")
    );
  } catch (error) {
    logger.error(
      { error: error instanceof Error ? error.message : String(error) },
      "Error verifying Coolify webhook signature"
    );
    return false;
  }
};

export const coolifyWebhooksRoutes = new Elysia().post(
  "/webhooks/coolify",
  async ({ request, set }) => {
    const signature = request.headers.get("x-coolify-signature") || "";
    const rawBody = await request.text();

    if (!verifyCoolifySignature(rawBody, signature)) {
      logger.warn("Invalid Coolify webhook signature");
      set.status = 401;
      return { error: "Invalid signature" };
    }

    let payload: Record<string, unknown>;
    try {
      payload = JSON.parse(rawBody);
    } catch {
      logger.warn("Coolify webhook: invalid JSON body");
      set.status = 400;
      return { error: "Invalid JSON" };
    }

    logger.info("Received Coolify webhook");

    // Handle asynchronously so we respond quickly to Coolify
    handleCoolifyDeployment(payload).catch((e) =>
      logger.error(e, "Coolify deployment handler failed")
    );

    return { received: true };
  }
);

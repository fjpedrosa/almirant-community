import { Elysia } from "elysia";
import { createHmac } from "crypto";
import { env, logger } from "@almirant/config";
import { handleDeploymentSucceeded } from "../services/vercel-webhook-handlers";

const verifyVercelSignature = (
  rawBody: string,
  signature: string
): boolean => {
  try {
    if (!env.VERCEL_WEBHOOK_SECRET) {
      logger.warn("VERCEL_WEBHOOK_SECRET not configured, skipping verification");
      return true;
    }

    const expected = createHmac("sha1", env.VERCEL_WEBHOOK_SECRET)
      .update(rawBody, "utf-8")
      .digest("hex");

    return expected === signature;
  } catch (error) {
    logger.error(
      { error: error instanceof Error ? error.message : String(error) },
      "Error verifying Vercel webhook signature"
    );
    return false;
  }
};

export const vercelWebhooksRoutes = new Elysia()
  .post("/webhooks/vercel", async ({ request, set }) => {
    const signature = request.headers.get("x-vercel-signature") || "";
    const rawBody = await request.text();

    if (!verifyVercelSignature(rawBody, signature)) {
      logger.warn("Invalid Vercel webhook signature");
      set.status = 401;
      return { error: "Invalid signature" };
    }

    const payload = JSON.parse(rawBody);
    const type = payload.type as string | undefined;

    logger.info({ type }, "Received Vercel webhook");

    if (type === "deployment.succeeded") {
      handleDeploymentSucceeded(payload).catch((e) =>
        logger.error(e, "Vercel deployment handler failed")
      );
    }

    return { received: true };
  });

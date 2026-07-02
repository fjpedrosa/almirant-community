import { Elysia } from "elysia";
import { logger, env } from "@almirant/config";
import { updateThankYouDeliveryStatus } from "@almirant/database";
import { createHmac, timingSafeEqual } from "crypto";

// Svix webhook signature verification
// Resend uses Svix for webhooks: https://svix.com/docs
function verifySvixSignature(
  payload: string,
  svixId: string,
  svixTimestamp: string,
  svixSignature: string,
  secret: string
): boolean {
  try {
    // Svix signed content: "{svix-id}.{svix-timestamp}.{payload}"
    const signedContent = `${svixId}.${svixTimestamp}.${payload}`;
    // Secret is base64-encoded after "whsec_" prefix
    const secretBytes = Buffer.from(secret.replace(/^whsec_/, ""), "base64");
    const hmac = createHmac("sha256", secretBytes);
    hmac.update(signedContent);
    const computedSig = hmac.digest("base64");

    // svixSignature may contain multiple signatures "v1,sig1 v1,sig2"
    const signatures = svixSignature.split(" ").map((s) => s.replace(/^v1,/, ""));
    return signatures.some((sig) => {
      try {
        return timingSafeEqual(Buffer.from(computedSig), Buffer.from(sig));
      } catch {
        return false;
      }
    });
  } catch {
    return false;
  }
}

interface ResendInboundAttachment {
  filename: string;
  content: string; // base64
  type: string;
}

interface ResendInboundPayload {
  from?: string;
  to?: string[];
  subject?: string;
  attachments?: ResendInboundAttachment[];
}

async function processInboundEmail(payload: ResendInboundPayload): Promise<void> {
  const { from, subject, attachments = [] } = payload;

  const invoiceAttachments = attachments.filter(
    (a) =>
      /\.(pdf|png|jpg|jpeg|webp)$/i.test(a.filename) ||
      ["application/pdf", "image/png", "image/jpeg", "image/webp"].includes(a.type)
  );

  if (invoiceAttachments.length === 0) {
    logger.info({ from, subject }, "No invoice attachments in inbound email, skipping");
    return;
  }

  // We cannot resolve workspaceId from the sender email without a user→org mapping.
  // Log a warning and skip — this is a future enhancement.
  // TODO: resolve workspaceId via sender email lookup once user→org lookup is available.
  logger.warn({ from, subject }, "Inbound email received but org resolution not yet implemented; skipping expense creation");
}

const DELIVERY_STATUS_MAP: Record<string, "delivered" | "bounced" | "complained"> = {
  "email.delivered": "delivered",
  "email.bounced": "bounced",
  "email.complained": "complained",
};

const verifyAndParseWebhook = (
  request: Request,
  rawBody: string,
  set: { status?: number | string },
): { type?: string; data?: Record<string, unknown> } | null => {
  const svixId = request.headers.get("svix-id") || "";
  const svixTimestamp = request.headers.get("svix-timestamp") || "";
  const svixSignature = request.headers.get("svix-signature") || "";

  const webhookSecret = env.RESEND_WEBHOOK_SECRET;
  if (webhookSecret) {
    if (!svixId || !svixTimestamp || !svixSignature) {
      logger.warn("Missing Svix headers on Resend webhook");
      set.status = 401;
      return null;
    }
    if (!verifySvixSignature(rawBody, svixId, svixTimestamp, svixSignature, webhookSecret)) {
      logger.warn({ svixId }, "Invalid Resend webhook signature");
      set.status = 401;
      return null;
    }
  }

  try {
    return JSON.parse(rawBody);
  } catch {
    set.status = 400;
    return null;
  }
};

export const resendWebhooksRoutes = new Elysia()
  .post("/webhooks/resend/inbound", async ({ request, set }) => {
    const rawBody = await request.text();
    const payload = verifyAndParseWebhook(request, rawBody, set);
    if (!payload) return { error: "Verification failed" };

    if (payload.type === "email.received" || payload.data) {
      const emailData = (payload.data || payload) as ResendInboundPayload;
      processInboundEmail(emailData).catch((err) =>
        logger.error({ err }, "Inbound email processing failed")
      );
    }

    return { received: true };
  })
  .post("/webhooks/resend/delivery", async ({ request, set }) => {
    const rawBody = await request.text();
    const payload = verifyAndParseWebhook(request, rawBody, set);
    if (!payload) return { error: "Verification failed" };

    const eventType = payload.type;
    const deliveryStatus = eventType ? DELIVERY_STATUS_MAP[eventType] : undefined;

    if (!deliveryStatus) {
      logger.debug({ eventType }, "[resend-webhook] Ignoring unhandled event type");
      return { received: true };
    }

    const emailId = (payload.data as Record<string, unknown>)?.email_id as string | undefined;
    if (!emailId) {
      logger.warn({ eventType }, "[resend-webhook] Delivery event missing email_id");
      return { received: true };
    }

    const updated = await updateThankYouDeliveryStatus(emailId, deliveryStatus);
    logger.info(
      { emailId, deliveryStatus, matched: updated },
      "[resend-webhook] Delivery status processed"
    );

    return { received: true };
  });


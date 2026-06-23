import { Elysia } from "elysia";
import { logger } from "@almirant/config";
import { verifyWebhookSignature } from "../services/github-service";
import {
  handlePushEvent,
  handlePullRequestEvent,
  handlePullRequestReviewEvent,
  handleCheckRunEvent,
  handleWorkflowRunEvent,
  handleInstallationEvent,
} from "../services/github-webhook-handlers";

export const githubWebhooksRoutes = new Elysia()
  .onParse(({ request }) => request.text())
  .post("/webhooks/github", async ({ body, request, set }) => {
    try {
      const signature = request.headers.get("x-hub-signature-256") || "";
      const event = request.headers.get("x-github-event") || "";
      const deliveryId = request.headers.get("x-github-delivery") || "";

      logger.info(
        { deliveryId, event, hasSignature: !!signature, signatureLength: signature.length },
        "[github-webhook] Incoming webhook"
      );

      const rawBody = body as string;

      logger.info(
        { deliveryId, event, bodyLength: rawBody.length, bodyEmpty: rawBody.length === 0 },
        "[github-webhook] Body read"
      );

      if (!(await verifyWebhookSignature(rawBody, signature))) {
        logger.warn(
          { deliveryId, event, bodyLength: rawBody.length, signaturePrefix: signature.slice(0, 20) },
          "[github-webhook] Invalid signature — rejecting with 401"
        );
        set.status = 401;
        return { error: "Invalid signature" };
      }

      logger.info({ deliveryId, event }, "[github-webhook] Signature verified OK");

      const payload = JSON.parse(rawBody);

      // Route to appropriate handler based on event type
      // Fire-and-forget: do not await so the webhook gets a fast 200 response
      switch (event) {
        case "push":
          handlePushEvent(payload, deliveryId).catch((e) =>
            logger.error(e, "Push handler failed")
          );
          break;
        case "pull_request":
          handlePullRequestEvent(payload, deliveryId).catch((e) =>
            logger.error(e, "PR handler failed")
          );
          break;
        case "pull_request_review":
          handlePullRequestReviewEvent(payload, deliveryId).catch((e) =>
            logger.error(e, "PR review handler failed")
          );
          break;
        case "check_run":
          handleCheckRunEvent(payload, deliveryId).catch((e) =>
            logger.error(e, "Check run handler failed")
          );
          break;
        case "workflow_run":
          handleWorkflowRunEvent(payload, deliveryId).catch((e) =>
            logger.error(e, "Workflow handler failed")
          );
          break;
        case "installation":
          handleInstallationEvent(payload, deliveryId).catch((e) =>
            logger.error(e, "Installation handler failed")
          );
          break;
        default:
          logger.info({ event, deliveryId }, "[github-webhook] Unhandled event type");
      }

      logger.info({ deliveryId, event }, "[github-webhook] Returning 200");
      return { received: true };
    } catch (error) {
      logger.error(
        { error: error instanceof Error ? error.message : String(error), stack: error instanceof Error ? error.stack : undefined },
        "[github-webhook] Unhandled error in webhook handler"
      );
      set.status = 500;
      return { error: "Internal error" };
    }
  });

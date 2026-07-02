import { Elysia, t } from "elysia";
import { sessionContextTypes } from "../../../shared/middleware/session-context-types.plugin";
import {
  getWebhooks,
  getWebhookById,
  createWebhook,
  updateWebhook,
  deleteWebhook,
  getWebhookLogs,
} from "@almirant/database";
import {
  successResponse,
  errorResponse,
  notFoundResponse,
} from "../../../shared/services/response";

type WebhookTrigger =
  | "work_item_created"
  | "work_item_updated"
  | "work_item_moved"
  | "work_item_deleted"
  | "comment_added"
  | "attachment_added"
  | "sprint_closed"
  | "milestone_completed";

export const webhooksRoutes = new Elysia({ prefix: "/webhooks" })
  .use(sessionContextTypes)

  // -------------------------------------------------------
  // GET /webhooks - List all webhooks
  // -------------------------------------------------------
  .get("/", async ({ activeWorkspace }) => {
    try {
      const orgId = activeWorkspace!.id;
      const webhooks = await getWebhooks(orgId);
      return successResponse(webhooks);
    } catch (error) {
      return errorResponse(
        error instanceof Error ? error.message : "Failed to fetch webhooks",
        500
      );
    }
  })

  // -------------------------------------------------------
  // POST /webhooks - Create webhook
  // -------------------------------------------------------
  .post(
    "/",
    async ({ body, set, activeWorkspace }) => {
      try {
        const orgId = activeWorkspace!.id;

        if (!body.name || body.name.trim() === "") {
          set.status = 400;
          return errorResponse("Name is required");
        }

        if (!body.url || body.url.trim() === "") {
          set.status = 400;
          return errorResponse("URL is required");
        }

        if (!body.trigger) {
          set.status = 400;
          return errorResponse("Trigger is required");
        }

        // Validate URL format
        try {
          new URL(body.url);
        } catch {
          set.status = 400;
          return errorResponse("Invalid URL format");
        }

        const webhook = await createWebhook(orgId, {
          name: body.name.trim(),
          url: body.url.trim(),
          trigger: body.trigger as WebhookTrigger,
          isActive: body.isActive,
          headers: body.headers,
        });

        set.status = 201;
        return successResponse(webhook);
      } catch (error) {
        set.status = 500;
        return errorResponse(
          error instanceof Error ? error.message : "Failed to create webhook",
          500
        );
      }
    },
    {
      body: t.Object({
        name: t.String(),
        url: t.String(),
        trigger: t.String(),
        isActive: t.Optional(t.Boolean()),
        headers: t.Optional(t.Record(t.String(), t.String())),
      }),
    }
  )

  // -------------------------------------------------------
  // GET /webhooks/:id - Get webhook by ID (optional: includeLogs)
  // -------------------------------------------------------
  .get(
    "/:id",
    async ({ params, query, set, activeWorkspace }) => {
      try {
        const orgId = activeWorkspace!.id;
        const webhook = await getWebhookById(orgId, params.id);

        if (!webhook) {
          set.status = 404;
          return notFoundResponse("Webhook");
        }

        if (query.includeLogs === "true") {
          const logs = await getWebhookLogs(orgId, params.id);
          return successResponse({ ...webhook, logs });
        }

        return successResponse(webhook);
      } catch (error) {
        set.status = 500;
        return errorResponse(
          error instanceof Error ? error.message : "Failed to fetch webhook",
          500
        );
      }
    },
    {
      params: t.Object({
        id: t.String(),
      }),
      query: t.Object({
        includeLogs: t.Optional(t.String()),
      }),
    }
  )

  // -------------------------------------------------------
  // PATCH /webhooks/:id - Update webhook
  // -------------------------------------------------------
  .patch(
    "/:id",
    async ({ params, body, set, activeWorkspace }) => {
      try {
        const orgId = activeWorkspace!.id;

        // Validate URL format if provided
        if (body.url) {
          try {
            new URL(body.url);
          } catch {
            set.status = 400;
            return errorResponse("Invalid URL format");
          }
        }

        const webhook = await updateWebhook(orgId, params.id, {
          name: body.name,
          url: body.url,
          trigger: body.trigger as WebhookTrigger | undefined,
          isActive: body.isActive,
          headers: body.headers,
        });

        if (!webhook) {
          set.status = 404;
          return notFoundResponse("Webhook");
        }

        return successResponse(webhook);
      } catch (error) {
        set.status = 500;
        return errorResponse(
          error instanceof Error ? error.message : "Failed to update webhook",
          500
        );
      }
    },
    {
      params: t.Object({
        id: t.String(),
      }),
      body: t.Object({
        name: t.Optional(t.String()),
        url: t.Optional(t.String()),
        trigger: t.Optional(t.String()),
        isActive: t.Optional(t.Boolean()),
        headers: t.Optional(t.Record(t.String(), t.String())),
      }),
    }
  )

  // -------------------------------------------------------
  // DELETE /webhooks/:id - Delete webhook
  // -------------------------------------------------------
  .delete(
    "/:id",
    async ({ params, set, activeWorkspace }) => {
      try {
        const orgId = activeWorkspace!.id;
        const deleted = await deleteWebhook(orgId, params.id);

        if (!deleted) {
          set.status = 404;
          return notFoundResponse("Webhook");
        }

        return successResponse({ deleted: true });
      } catch (error) {
        set.status = 500;
        return errorResponse(
          error instanceof Error ? error.message : "Failed to delete webhook",
          500
        );
      }
    },
    {
      params: t.Object({
        id: t.String(),
      }),
    }
  )

  // -------------------------------------------------------
  // POST /webhooks/:id/test - Test webhook
  // -------------------------------------------------------
  .post(
    "/:id/test",
    async ({ params, set, activeWorkspace }) => {
      try {
        const orgId = activeWorkspace!.id;
        const webhook = await getWebhookById(orgId, params.id);

        if (!webhook) {
          set.status = 404;
          return notFoundResponse("Webhook");
        }

        const testPayload = {
          event: "work_item_created",
          timestamp: new Date().toISOString(),
          workItem: {
            id: "test-work-item-id",
            title: "Test Work Item",
            type: "task",
            priority: "medium",
            boardColumn: "In Progress",
          },
        };

        try {
          const response = await fetch(webhook.url, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              ...(webhook.headers || {}),
            },
            body: JSON.stringify(testPayload),
          });

          return successResponse({
            success: response.ok,
            responseStatus: response.status,
            error: response.ok ? undefined : `HTTP ${response.status}`,
          });
        } catch (fetchError) {
          return successResponse({
            success: false,
            error: fetchError instanceof Error ? fetchError.message : String(fetchError),
          });
        }
      } catch (error) {
        set.status = 500;
        return errorResponse(
          error instanceof Error ? error.message : "Failed to test webhook",
          500
        );
      }
    },
    {
      params: t.Object({
        id: t.String(),
      }),
    }
  );

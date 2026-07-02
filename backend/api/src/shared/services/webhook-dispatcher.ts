import {
  getWebhooksByTrigger,
  createWebhookLog,
  updateWebhookLog,
} from "@almirant/database";
import { logger } from "@almirant/config";

// ---- Domain types (webhook-specific) ----

type WebhookTrigger =
  | "work_item_created"
  | "work_item_updated"
  | "work_item_moved"
  | "work_item_deleted"
  | "comment_added"
  | "attachment_added"
  | "sprint_closed"
  | "milestone_completed";

interface WebhookPayload {
  event: WebhookTrigger;
  timestamp: string;
  data: Record<string, unknown>;
}

interface WebhookDispatchOptions {
  workspaceId: string;
  trigger: WebhookTrigger;
  data: Record<string, unknown>;
}

// ---- Business logic ----

const MAX_RETRIES = 3;
const RETRY_DELAYS = [1000, 5000, 15000]; // 1s, 5s, 15s

// Build webhook payload
const buildPayload = (options: WebhookDispatchOptions): WebhookPayload => {
  return {
    event: options.trigger,
    timestamp: new Date().toISOString(),
    data: options.data,
  };
};

// Execute webhook with retry
const executeWebhook = async (
  url: string,
  payload: WebhookPayload,
  headers: Record<string, string>,
  webhookId: string
): Promise<void> => {
  // Create initial log
  const log = await createWebhookLog({
    webhookId,
    status: "pending",
    requestPayload: payload as unknown as Record<string, unknown>,
    responseStatus: null,
    responseBody: null,
    errorMessage: null,
    retryCount: 0,
  });

  let lastError: Error | null = null;
  let retryCount = 0;

  while (retryCount <= MAX_RETRIES) {
    try {
      const response = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...headers,
        },
        body: JSON.stringify(payload),
      });

      const responseBody = await response.text();

      if (response.ok) {
        // Success
        await updateWebhookLog(log.id, {
          status: "success",
          responseStatus: response.status,
          responseBody,
          retryCount,
        });
        return;
      } else {
        // HTTP error
        lastError = new Error(`HTTP ${response.status}: ${responseBody}`);
        await updateWebhookLog(log.id, {
          status: "failed",
          responseStatus: response.status,
          responseBody,
          errorMessage: lastError.message,
          retryCount,
        });
      }
    } catch (error) {
      // Network error
      lastError = error instanceof Error ? error : new Error(String(error));
      await updateWebhookLog(log.id, {
        status: "failed",
        errorMessage: lastError.message,
        retryCount,
      });
    }

    // Wait before retry (exponential backoff)
    if (retryCount < MAX_RETRIES) {
      await new Promise((resolve) =>
        setTimeout(resolve, RETRY_DELAYS[retryCount])
      );
    }

    retryCount++;
  }

  logger.error(
    `Webhook ${webhookId} failed after ${MAX_RETRIES} retries: ${lastError?.message}`
  );
};

// Dispatch webhooks for an event
export const dispatchWebhooks = async (
  options: WebhookDispatchOptions
): Promise<void> => {
  const { workspaceId, trigger } = options;

  // Get matching webhooks
  const webhooksToDispatch = await getWebhooksByTrigger(
    workspaceId,
    trigger
  );

  if (webhooksToDispatch.length === 0) {
    return;
  }

  // Build payload
  const payload = buildPayload(options);

  // Execute all webhooks in parallel (fire and forget)
  Promise.all(
    webhooksToDispatch.map((webhook) =>
      executeWebhook(
        webhook.url,
        payload,
        webhook.headers || {},
        webhook.id
      ).catch((error) => {
        logger.error(`Error dispatching webhook ${webhook.id}: ${error}`);
      })
    )
  );
};

// Test webhook
export const testWebhook = async (
  webhookId: string,
  url: string,
  headers: Record<string, string>
): Promise<{ success: boolean; responseStatus?: number; error?: string }> => {
  const testPayload: WebhookPayload = {
    event: "work_item_created",
    timestamp: new Date().toISOString(),
    data: {
      workItem: {
        id: "test-work-item-id",
        title: "Test Work Item",
        type: "task",
        priority: "medium",
        boardColumn: "In Progress",
      },
    },
  };

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...headers,
      },
      body: JSON.stringify(testPayload),
    });

    return {
      success: response.ok,
      responseStatus: response.status,
      error: response.ok ? undefined : `HTTP ${response.status}`,
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
};

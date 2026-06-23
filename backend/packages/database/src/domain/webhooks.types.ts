// ──────────────────────────────────────────────
// Webhooks
// ──────────────────────────────────────────────

export type WebhookTrigger = "tag_added";
export type WebhookStatus = "pending" | "success" | "failed";

export interface Webhook {
  id: string;
  name: string;
  url: string;
  trigger: WebhookTrigger;
  isActive: boolean | null;
  headers: Record<string, string> | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface WebhookLog {
  id: string;
  webhookId: string;
  status: WebhookStatus;
  requestPayload: Record<string, unknown> | null;
  responseStatus: number | null;
  responseBody: string | null;
  errorMessage: string | null;
  retryCount: number | null;
  executedAt: Date;
}

export interface CreateWebhookRequest {
  name: string;
  url: string;
  trigger: WebhookTrigger;
  isActive?: boolean;
  headers?: Record<string, string>;
}

export interface UpdateWebhookRequest {
  name?: string;
  url?: string;
  trigger?: WebhookTrigger;
  isActive?: boolean;
  headers?: Record<string, string>;
}

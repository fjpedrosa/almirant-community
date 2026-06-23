import type { WebhookTrigger, WebhookStatus } from "@/domains/shared/domain/types";

// Webhook entity
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

// Webhook log
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

// Create webhook request
export interface CreateWebhookRequest {
  name: string;
  url: string;
  trigger: WebhookTrigger;
  isActive?: boolean;
  headers?: Record<string, string>;
}

// Update webhook request
export interface UpdateWebhookRequest {
  name?: string;
  url?: string;
  trigger?: WebhookTrigger;
  isActive?: boolean;
  headers?: Record<string, string>;
}

// Webhook payload (sent to external services like N8N)
export interface WebhookPayload {
  event: WebhookTrigger;
  timestamp: string;
  data: Record<string, unknown>;
}

// Webhook dispatch options
export interface WebhookDispatchOptions {
  trigger: WebhookTrigger;
  data: Record<string, unknown>;
}

// ---- Presentation layer props ----

// Component props for WebhookCard
export interface WebhookCardProps {
  webhook: Webhook;
  testingId: string | null;
  onToggle: (id: string, isActive: boolean) => void;
  onTest: (id: string) => void;
  onDelete: (id: string, name: string) => void;
  triggerLabels: Record<string, string>;
}

// Component props for WebhooksList
export interface WebhooksListProps {
  webhooks: Webhook[];
  isLoading: boolean;
  testingId: string | null;
  onToggle: (id: string, isActive: boolean) => void;
  onTest: (id: string) => void;
  onDelete: (id: string, name: string) => void;
  onCreateClick: () => void;
  triggerLabels: Record<string, string>;
}

// Component props for CreateWebhookDialog
export interface CreateWebhookDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  form: any;
  isPending: boolean;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  onSubmit: (data: any) => void;
  triggerLabels: Record<string, string>;
}

// Component props for WebhookInfoCard
// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export interface WebhookInfoCardProps {}

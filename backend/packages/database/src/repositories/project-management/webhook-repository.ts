import { db } from "../../client";
import { webhooks, webhookLogs } from "../../schema";
import { eq, and, desc } from "drizzle-orm";

// Infer types from schema (avoids dependency on domain/types which has stale values)
type Webhook = typeof webhooks.$inferSelect;
type WebhookLog = typeof webhookLogs.$inferSelect;
type WebhookTrigger = Webhook["trigger"];

// Get all webhooks
export const getWebhooks = async (workspaceId: string): Promise<Webhook[]> => {
  return db
    .select()
    .from(webhooks)
    .where(eq(webhooks.workspaceId, workspaceId))
    .orderBy(desc(webhooks.createdAt));
};

// Get webhook by ID
export const getWebhookById = async (
  workspaceId: string,
  id: string
): Promise<Webhook | null> => {
  const [webhook] = await db
    .select()
    .from(webhooks)
    .where(and(eq(webhooks.id, id), eq(webhooks.workspaceId, workspaceId)))
    .limit(1);

  return webhook || null;
};

// Get webhooks by trigger
export const getWebhooksByTrigger = async (
  workspaceId: string,
  trigger: WebhookTrigger
): Promise<Webhook[]> => {
  return db
    .select()
    .from(webhooks)
    .where(
      and(
        eq(webhooks.trigger, trigger),
        eq(webhooks.isActive, true),
        eq(webhooks.workspaceId, workspaceId)
      )
    );
};

// Create webhook
export const createWebhook = async (
  workspaceId: string,
  data: {
    name: string;
    url: string;
    trigger: WebhookTrigger;
    isActive?: boolean;
    headers?: Record<string, string>;
  }
): Promise<Webhook> => {
  const [newWebhook] = await db
    .insert(webhooks)
    .values({
      name: data.name,
      url: data.url,
      trigger: data.trigger,
      isActive: data.isActive ?? true,
      headers: data.headers || {},
      workspaceId,
    })
    .returning();

  if (!newWebhook) throw new Error("Failed to create webhook");
  return newWebhook;
};

// Update webhook
export const updateWebhook = async (
  workspaceId: string,
  id: string,
  data: {
    name?: string;
    url?: string;
    trigger?: WebhookTrigger;
    isActive?: boolean;
    headers?: Record<string, string>;
  }
): Promise<Webhook | null> => {
  const [updated] = await db
    .update(webhooks)
    .set({
      ...data,
      updatedAt: new Date(),
    })
    .where(and(eq(webhooks.id, id), eq(webhooks.workspaceId, workspaceId)))
    .returning();

  return updated || null;
};

// Delete webhook
export const deleteWebhook = async (workspaceId: string, id: string): Promise<boolean> => {
  const result = await db.delete(webhooks).where(and(eq(webhooks.id, id), eq(webhooks.workspaceId, workspaceId))).returning();
  return result.length > 0;
};

// Get webhook logs
export const getWebhookLogs = async (
  workspaceId: string,
  webhookId: string,
  limit = 50
): Promise<WebhookLog[]> => {
  // Verify webhook belongs to workspace
  const [webhook] = await db
    .select({ id: webhooks.id })
    .from(webhooks)
    .where(and(eq(webhooks.id, webhookId), eq(webhooks.workspaceId, workspaceId)))
    .limit(1);

  if (!webhook) return [];

  return db
    .select()
    .from(webhookLogs)
    .where(eq(webhookLogs.webhookId, webhookId))
    .orderBy(desc(webhookLogs.executedAt))
    .limit(limit);
};

// Create webhook log
export const createWebhookLog = async (
  data: Omit<WebhookLog, "id" | "executedAt">
): Promise<WebhookLog> => {
  const [log] = await db
    .insert(webhookLogs)
    .values(data)
    .returning();

  if (!log) throw new Error("Failed to create webhook log");
  return log;
};

// Update webhook log
export const updateWebhookLog = async (
  id: string,
  data: Partial<WebhookLog>
): Promise<WebhookLog | null> => {
  const [updated] = await db
    .update(webhookLogs)
    .set(data)
    .where(eq(webhookLogs.id, id))
    .returning();

  return updated || null;
};

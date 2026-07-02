/**
 * In-memory store for link tokens used by the CLI-to-web credential transfer flow.
 *
 * Link tokens are ephemeral (10-minute TTL, single-use) so an in-memory Map is
 * appropriate. Tokens do not survive server restarts, but given the short TTL
 * this is acceptable.
 */

export type LinkTokenStatus = "pending" | "completed";

export type LinkToken = {
  token: string;
  userId: string;
  workspaceId: string;
  provider: string;
  scope: "user" | "organization";
  status: LinkTokenStatus;
  credentials: Record<string, unknown> | null;
  config: Record<string, unknown> | null;
  connectionName: string | null;
  createdAt: Date;
  expiresAt: Date;
};

const TOKEN_TTL_MS = 10 * 60 * 1000; // 10 minutes
const CLEANUP_INTERVAL_MS = 60 * 1000; // cleanup every 60s

const store = new Map<string, LinkToken>();

let cleanupTimer: ReturnType<typeof setInterval> | null = null;

const startCleanup = () => {
  if (cleanupTimer) return;
  cleanupTimer = setInterval(() => {
    const now = Date.now();
    for (const [key, entry] of store) {
      if (now > entry.expiresAt.getTime()) {
        store.delete(key);
      }
    }
    if (store.size === 0 && cleanupTimer) {
      clearInterval(cleanupTimer);
      cleanupTimer = null;
    }
  }, CLEANUP_INTERVAL_MS);
};

export const createLinkToken = (params: {
  userId: string;
  workspaceId: string;
  provider: string;
  scope: "user" | "organization";
}): LinkToken => {
  const token = crypto.randomUUID();
  const now = new Date();
  const entry: LinkToken = {
    token,
    userId: params.userId,
    workspaceId: params.workspaceId,
    provider: params.provider,
    scope: params.scope,
    status: "pending",
    credentials: null,
    config: null,
    connectionName: null,
    createdAt: now,
    expiresAt: new Date(now.getTime() + TOKEN_TTL_MS),
  };
  store.set(token, entry);
  startCleanup();
  return entry;
};

export const getLinkToken = (token: string): LinkToken | null => {
  const entry = store.get(token);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt.getTime()) {
    store.delete(token);
    return null;
  }
  return entry;
};

export const completeLinkToken = (
  token: string,
  payload: {
    credentials: Record<string, unknown>;
    config?: Record<string, unknown>;
    connectionName?: string;
  },
): LinkToken | null => {
  const entry = store.get(token);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt.getTime()) {
    store.delete(token);
    return null;
  }
  if (entry.status !== "pending") return null;

  entry.status = "completed";
  entry.credentials = payload.credentials;
  entry.config = payload.config ?? null;
  entry.connectionName = payload.connectionName ?? null;
  return entry;
};

export const deleteLinkToken = (token: string): void => {
  store.delete(token);
};

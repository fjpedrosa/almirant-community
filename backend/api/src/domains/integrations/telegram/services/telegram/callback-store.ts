import crypto from "crypto";

type StoredCallback<T> = {
  payload: T;
  expiresAt: number;
};

const store = new Map<string, StoredCallback<unknown>>();

const DEFAULT_TTL_MS = 10 * 60 * 1000;
const MAX_STORE_SIZE = 500;

function cleanup(now: number): void {
  for (const [key, entry] of store.entries()) {
    if (entry.expiresAt <= now) store.delete(key);
  }

  // Best-effort guardrail: if we still grew too much, drop oldest-ish entries.
  if (store.size <= MAX_STORE_SIZE) return;
  let dropped = 0;
  for (const key of store.keys()) {
    store.delete(key);
    dropped += 1;
    if (store.size <= MAX_STORE_SIZE) break;
  }
}

export const callbackStore = {
  put<T>(payload: T, ttlMs = DEFAULT_TTL_MS): string {
    const now = Date.now();
    cleanup(now);

    // Keep tokens short to fit in Telegram callback_data (64 bytes limit).
    const token = crypto.randomBytes(8).toString("base64url");
    store.set(token, { payload, expiresAt: now + ttlMs });
    return token;
  },

  take<T>(token: string): T | null {
    const now = Date.now();
    cleanup(now);

    const entry = store.get(token);
    if (!entry) return null;
    store.delete(token);
    return entry.payload as T;
  },

  peek<T>(token: string): T | null {
    const now = Date.now();
    cleanup(now);

    const entry = store.get(token);
    if (!entry) return null;
    return entry.payload as T;
  },
};


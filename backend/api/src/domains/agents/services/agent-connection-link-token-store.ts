/**
 * Ephemeral one-use link-token store for external agent pairing.
 *
 * The token is deliberately short-lived and only bootstraps the exchange. It is
 * not the long-lived credential. Claiming it consumes the token and creates a
 * scoped, revocable API key that the agent receives exactly once.
 */

export type AgentConnectionTokenStatus = "pending" | "claimed";
export type AgentConnectionClaimResult = Record<string, unknown>;

export interface AgentConnectionLinkToken {
  token: string;
  userId: string;
  workspaceId: string;
  projectId: string | null;
  projectName: string | null;
  agentName: string;
  baseUrl: string;
  status: AgentConnectionTokenStatus;
  createdAt: Date;
  expiresAt: Date;
  claimedAt: Date | null;
  claimResult: AgentConnectionClaimResult | null;
}

export type ConsumeAgentConnectionLinkTokenResult =
  | { ok: true; entry: AgentConnectionLinkToken }
  | {
      ok: false;
      reason: "not_found" | "expired" | "already_claimed";
      entry?: AgentConnectionLinkToken;
      claimResult?: AgentConnectionClaimResult | null;
    };

const TOKEN_TTL_MS = 10 * 60 * 1000;
const CLEANUP_INTERVAL_MS = 60 * 1000;

const store = new Map<string, AgentConnectionLinkToken>();
let cleanupTimer: ReturnType<typeof setInterval> | null = null;

const startCleanup = () => {
  if (cleanupTimer) return;

  cleanupTimer = setInterval(() => {
    const now = Date.now();
    for (const [token, entry] of store) {
      if (now > entry.expiresAt.getTime()) {
        store.delete(token);
      }
    }

    if (store.size === 0 && cleanupTimer) {
      clearInterval(cleanupTimer);
      cleanupTimer = null;
    }
  }, CLEANUP_INTERVAL_MS);
};

export const createAgentConnectionLinkToken = (params: {
  userId: string;
  workspaceId: string;
  projectId: string | null;
  projectName: string | null;
  agentName: string;
  baseUrl: string;
}): AgentConnectionLinkToken => {
  const now = new Date();
  const token = crypto.randomUUID();
  const entry: AgentConnectionLinkToken = {
    token,
    userId: params.userId,
    workspaceId: params.workspaceId,
    projectId: params.projectId,
    projectName: params.projectName,
    agentName: params.agentName,
    baseUrl: params.baseUrl,
    status: "pending",
    createdAt: now,
    expiresAt: new Date(now.getTime() + TOKEN_TTL_MS),
    claimedAt: null,
    claimResult: null,
  };

  store.set(token, entry);
  startCleanup();
  return entry;
};

export const getAgentConnectionLinkToken = (
  token: string,
): AgentConnectionLinkToken | null => {
  const entry = store.get(token);
  if (!entry) return null;

  if (Date.now() > entry.expiresAt.getTime()) {
    store.delete(token);
    return null;
  }

  return entry;
};

export const consumeAgentConnectionLinkToken = (
  token: string,
): ConsumeAgentConnectionLinkTokenResult => {
  const entry = store.get(token);
  if (!entry) return { ok: false, reason: "not_found" };

  if (Date.now() > entry.expiresAt.getTime()) {
    store.delete(token);
    return { ok: false, reason: "expired" };
  }

  if (entry.status !== "pending") {
    return {
      ok: false,
      reason: "already_claimed",
      entry,
      claimResult: entry.claimResult,
    };
  }

  // Mark before any async credential creation work so two concurrent claims
  // cannot mint two credentials from the same pairing token.
  entry.status = "claimed";
  entry.claimedAt = new Date();
  return { ok: true, entry };
};

export const completeAgentConnectionLinkTokenClaim = (
  token: string,
  claimResult: AgentConnectionClaimResult,
): AgentConnectionLinkToken | null => {
  const entry = store.get(token);
  if (!entry || entry.status !== "claimed") return null;

  entry.claimResult = claimResult;
  return entry;
};

export const releaseAgentConnectionLinkTokenClaim = (token: string): void => {
  const entry = store.get(token);
  if (!entry || entry.claimResult) return;

  entry.status = "pending";
  entry.claimedAt = null;
};

export const clearAgentConnectionLinkTokensForTests = (): void => {
  store.clear();
  if (cleanupTimer) {
    clearInterval(cleanupTimer);
    cleanupTimer = null;
  }
};

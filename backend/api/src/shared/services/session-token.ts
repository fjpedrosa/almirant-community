import jwt from "jsonwebtoken";
import { randomBytes } from "crypto";

/**
 * Scoped session tokens for MCP agent containers.
 *
 * Instead of injecting the global worker API key into agent containers,
 * the runner requests a short-lived JWT with limited permissions.
 * The MCP endpoints validate these tokens via the session-token-auth middleware.
 */

export interface SessionTokenPayload {
  /**
   * Project the agent is working on.
   *
   * Optional for organization-scoped MCP sessions such as ChatGPT connectors
   * that need to create/list projects before a specific project exists.
   */
  projectId?: string;
  /** Organization owning the project or organization-scoped session */
  organizationId: string;
  /** Optional actor user for audit/comment attribution inside MCP tools */
  userId?: string;
  /**
   * Optional agent job id this token is minted for. When present, MCP tools
   * such as `complete_ai_task` persist it as `ai_sessions.agent_job_id` so
   * the runner INV-4 completion guard can deterministically match expected
   * vs completed leaf tasks — even when the orchestrator invokes the tool
   * via raw `curl $MCP_URL` rather than the native MCP tool interface.
   */
  jobId?: string;
  /** Allowed MCP tool categories (e.g. ["mcp:read", "mcp:write"]) */
  permissions: string[];
  /** "agent" for containers, "worker" for the runner itself */
  sessionType: "agent" | "worker";
  /** Unique token identifier for revocation / auditing */
  jti: string;
}

/** Prefix so middleware can quickly identify session tokens vs regular API keys */
export const SESSION_TOKEN_PREFIX = "st_";
/** Synthetic user used by unattended automation when no human creator exists. */
export const AUTOMATION_BOT_USER_ID = "auto-fix-bot";

/**
 * Exhaustive whitelist of valid MCP permission scopes.
 * generateSessionToken and verifySessionToken reject any permission outside this list.
 *
 * Gating:
 *   mcp:read, mcp:write  — all API keys by default
 *   mcp:internal         — privileged keys; required to access /mcp/internal
 *   mcp:debug            — privileged keys; required to call mutating debug tools
 */
export const VALID_SESSION_TOKEN_PERMISSIONS = [
  "mcp:read",
  "mcp:write",
  "mcp:internal",
  "mcp:debug",
] as const;

export type ValidSessionTokenPermission = typeof VALID_SESSION_TOKEN_PERMISSIONS[number];

const DEFAULT_TTL_SECONDS = 3600; // 1 hour
const MAX_TTL_SECONDS = 86400; // 24 hours

/**
 * Generate a scoped session token (JWT signed with HMAC-SHA256).
 *
 * @param params.signingSecret  Secret used for HMAC-SHA256 signing (from env)
 * @param params.ttlSeconds     Token lifetime (default 1h, max 24h)
 * @returns Prefixed JWT string
 */
export function generateSessionToken(params: {
  projectId?: string;
  organizationId: string;
  userId?: string;
  jobId?: string;
  permissions: string[];
  sessionType?: "agent" | "worker";
  ttlSeconds?: number;
  signingSecret: string;
}): string {
  const invalid = params.permissions.filter(
    (p) => !(VALID_SESSION_TOKEN_PERMISSIONS as readonly string[]).includes(p)
  );
  if (invalid.length > 0) {
    throw new Error(
      `generateSessionToken: invalid permission(s): ${invalid.join(", ")}. ` +
      `Valid values: ${VALID_SESSION_TOKEN_PERMISSIONS.join(", ")}`
    );
  }

  const ttl = Math.min(
    params.ttlSeconds ?? DEFAULT_TTL_SECONDS,
    MAX_TTL_SECONDS
  );

  const jti = randomBytes(16).toString("hex");

  const payload: SessionTokenPayload = {
    organizationId: params.organizationId,
    ...(params.projectId ? { projectId: params.projectId } : {}),
    ...(params.userId ? { userId: params.userId } : {}),
    ...(params.jobId ? { jobId: params.jobId } : {}),
    permissions: params.permissions,
    sessionType: params.sessionType ?? "agent",
    jti,
  };

  const token = jwt.sign(payload, params.signingSecret, {
    algorithm: "HS256",
    expiresIn: ttl,
    issuer: "almirant-api",
    subject: `session:${params.organizationId}:${params.projectId ?? "org"}`,
  });

  return `${SESSION_TOKEN_PREFIX}${token}`;
}

/**
 * Verify and decode a session token.
 *
 * @returns The decoded payload, or `null` if the token is invalid/expired.
 */
export function verifySessionToken(
  prefixedToken: string,
  signingSecret: string
): SessionTokenPayload | null {
  const raw = prefixedToken.startsWith(SESSION_TOKEN_PREFIX)
    ? prefixedToken.slice(SESSION_TOKEN_PREFIX.length)
    : prefixedToken;

  try {
    const decoded = jwt.verify(raw, signingSecret, {
      algorithms: ["HS256"],
      issuer: "almirant-api",
    });

    if (typeof decoded === "string") return null;

    const payload = decoded as jwt.JwtPayload & Partial<SessionTokenPayload>;

    // Validate required fields
    if (
      !payload.organizationId ||
      !Array.isArray(payload.permissions) ||
      !payload.sessionType ||
      !payload.jti
    ) {
      return null;
    }

    // Defense in depth: reject tokens whose permissions include unknown values.
    // Prevents tokens minted with a pre-whitelist signing secret from being used
    // with escalated permission strings after the whitelist is deployed.
    const unknownPerms = payload.permissions.filter(
      (p) => !(VALID_SESSION_TOKEN_PERMISSIONS as readonly string[]).includes(p)
    );
    if (unknownPerms.length > 0) {
      return null;
    }

    return {
      organizationId: payload.organizationId,
      ...(typeof payload.projectId === "string" ? { projectId: payload.projectId } : {}),
      ...(typeof payload.userId === "string" ? { userId: payload.userId } : {}),
      ...(typeof payload.jobId === "string" ? { jobId: payload.jobId } : {}),
      permissions: payload.permissions,
      sessionType: payload.sessionType,
      jti: payload.jti,
    };
  } catch {
    return null;
  }
}

/**
 * Compute the absolute expiration date for a given TTL.
 */
export function computeExpiresAt(ttlSeconds?: number): Date {
  const ttl = Math.min(ttlSeconds ?? DEFAULT_TTL_SECONDS, MAX_TTL_SECONDS);
  return new Date(Date.now() + ttl * 1000);
}

/**
 * Resolve the actor user that should be embedded in an MCP session token.
 * - Human-triggered jobs keep the creator as the actor.
 * - Unattended scheduled jobs fall back to the automation bot.
 */
export function resolveSessionActorUserId(job: {
  createdByUserId?: string | null;
  jobType?: string | null;
}): string | undefined {
  if (job.createdByUserId) return job.createdByUserId;
  if (job.jobType === "scheduled") return AUTOMATION_BOT_USER_ID;
  return undefined;
}

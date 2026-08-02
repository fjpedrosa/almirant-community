import { createHash, createHmac, timingSafeEqual, randomUUID } from "node:crypto";
import { Elysia, t } from "elysia";
import {
  findRecentFeedbackByDedupeKey,
  getFeedbackSourceByPublicKey,
} from "@almirant/database";
import { env, logger } from "@almirant/config";
import { errorResponse, internalErrorResponse, successResponse } from "../../../shared/services/response";
import { createFeedbackItemWithPipeline } from "../services/feedback-item-service";
import { broadcastFeedbackItemCreated } from "../../../shared/ws/feedback-events";

type WidgetTokenPayload = {
  sourceId: string;
  publicKey: string;
  jti: string;
  exp: number;
};

type PublicFeedbackSourceConfig = {
  requireCaptcha?: unknown;
  workspaceId?: unknown;
  projectId?: unknown;
};

const ingestRateLimitState = new Map<string, { count: number; resetAt: number }>();

const toBase64Url = (value: string) => Buffer.from(value).toString("base64url");
const fromBase64Url = (value: string) => Buffer.from(value, "base64url").toString("utf-8");

const getWidgetTokenSecret = (): string => {
  if (env.ENCRYPTION_KEY) return env.ENCRYPTION_KEY;
  if (env.NODE_ENV === "production") {
    throw new Error("ENCRYPTION_KEY is required in production for widget token signing");
  }
  return "dev-feedback-widget-secret-not-for-production";
};

const signWidgetToken = (payload: WidgetTokenPayload): string => {
  const encodedPayload = toBase64Url(JSON.stringify(payload));
  const signature = createHmac("sha256", getWidgetTokenSecret())
    .update(encodedPayload)
    .digest("hex");
  return `${encodedPayload}.${signature}`;
};

const verifyWidgetToken = (token: string): WidgetTokenPayload | null => {
  const parts = token.split(".");
  if (parts.length !== 2) return null;
  const [encodedPayload, signature] = parts;
  if (!encodedPayload || !signature) return null;

  const expected = createHmac("sha256", getWidgetTokenSecret())
    .update(encodedPayload)
    .digest("hex");

  if (expected.length !== signature.length) return null;

  const valid = timingSafeEqual(Buffer.from(expected, "utf-8"), Buffer.from(signature, "utf-8"));
  if (!valid) return null;

  try {
    const payload = JSON.parse(fromBase64Url(encodedPayload)) as WidgetTokenPayload;
    if (!payload.sourceId || !payload.publicKey || !payload.exp) return null;
    if (Date.now() > payload.exp * 1000) return null;
    return payload;
  } catch {
    return null;
  }
};

const getClientIp = (request: Request): string => {
  const forwardedFor = request.headers.get("x-forwarded-for");
  if (forwardedFor) {
    const first = forwardedFor.split(",")[0]?.trim();
    if (first) return first;
  }
  const realIp = request.headers.get("x-real-ip");
  if (realIp) return realIp.trim();
  return "unknown";
};

const extractOriginHost = (origin: string): string | null => {
  try {
    return new URL(origin).host.toLowerCase();
  } catch {
    return null;
  }
};

const getTrimmedString = (value: unknown): string | null => {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
};

const isAllowedOrigin = (origin: string | null, allowedDomains: string[] | null | undefined): boolean => {
  if (!origin) return false;
  const originHost = extractOriginHost(origin);
  if (!originHost) return false;

  const cleanedDomains = (allowedDomains ?? [])
    .map((domain) => domain.trim().toLowerCase())
    .filter(Boolean);

  if (cleanedDomains.length === 0) return true;

  return cleanedDomains.some((domainPattern) => {
    if (domainPattern.startsWith("*.")) {
      const suffix = domainPattern.slice(2);
      return originHost === suffix || originHost.endsWith(`.${suffix}`);
    }
    return originHost === domainPattern;
  });
};

const isCaptchaRequired = (config: Record<string, unknown> | null | undefined): boolean => {
  const raw = config?.requireCaptcha;
  if (typeof raw === "boolean") return raw;
  return true;
};

const resolveSourceOwnershipContext = (
  config: PublicFeedbackSourceConfig | null | undefined
): {
  workspaceId: string | null;
  projectId: string | null;
} => ({
  workspaceId: getTrimmedString(config?.workspaceId),
  projectId: getTrimmedString(config?.projectId),
});

const verifyHCaptcha = async (
  token: string | undefined,
  ip: string
): Promise<{ ok: true } | { ok: false; reason: string }> => {
  if (!env.HCAPTCHA_SECRET_KEY) {
    return { ok: false, reason: "Captcha is not configured on server" };
  }
  if (!token) {
    return { ok: false, reason: "captchaToken is required" };
  }

  try {
    const response = await fetch("https://hcaptcha.com/siteverify", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        secret: env.HCAPTCHA_SECRET_KEY,
        response: token,
        remoteip: ip,
      }),
    });
    if (!response.ok) {
      return { ok: false, reason: "Captcha verification failed" };
    }

    const data = await response.json() as { success?: boolean; "error-codes"?: string[] };
    if (!data.success) {
      return { ok: false, reason: data["error-codes"]?.join(", ") || "Invalid captcha token" };
    }

    return { ok: true };
  } catch (error) {
    logger.error({ error }, "hCaptcha verification request failed");
    return { ok: false, reason: "Captcha verification failed" };
  }
};

const allowIngestByRateLimit = (key: string): boolean => {
  const now = Date.now();
  const current = ingestRateLimitState.get(key);
  if (!current || now > current.resetAt) {
    ingestRateLimitState.set(key, {
      count: 1,
      resetAt: now + env.FEEDBACK_INGEST_RATE_LIMIT_WINDOW_MS,
    });
    return true;
  }

  if (current.count >= env.FEEDBACK_INGEST_RATE_LIMIT_MAX) return false;
  current.count += 1;
  return true;
};

const normalizeFeedbackCategory = (
  category: string | undefined
): "bug" | "feature_request" | "improvement" | "question" | "praise" | "other" => {
  const allowed = new Set(["bug", "feature_request", "improvement", "question", "praise", "other"]);
  if (!category) return "other";
  return allowed.has(category) ? (category as "bug" | "feature_request" | "improvement" | "question" | "praise" | "other") : "other";
};

const buildDedupeKey = (args: {
  sourceId: string;
  message: string;
  email?: string;
  pageUrl?: string;
  locale?: string;
}): string => {
  const normalized = [
    args.sourceId,
    args.message.trim().toLowerCase(),
    (args.email ?? "").trim().toLowerCase(),
    (args.pageUrl ?? "").trim().toLowerCase(),
    (args.locale ?? "").trim().toLowerCase(),
  ].join("|");

  return createHash("sha256").update(normalized).digest("hex");
};

export const publicFeedbackRoutes = new Elysia({ prefix: "/feedback" })
  .get(
    "/widget/bootstrap",
    async ({ query, request, set }) => {
      try {
        const source = await getFeedbackSourceByPublicKey(query.publicKey);
        if (!source) {
          set.status = 404;
          return errorResponse("Feedback source not found", 404);
        }

        const origin = request.headers.get("origin");
        if (!isAllowedOrigin(origin, source.allowedDomains)) {
          set.status = 403;
          return errorResponse("Origin is not allowed", 403);
        }

        const sourceContext = resolveSourceOwnershipContext(
          source.config as PublicFeedbackSourceConfig | null | undefined
        );
        if (!sourceContext.workspaceId) {
          set.status = 409;
          return errorResponse(
            "Feedback source is not configured with a workspace",
            409
          );
        }

        const nowSec = Math.floor(Date.now() / 1000);
        const expiresAt = nowSec + env.FEEDBACK_WIDGET_TOKEN_TTL_SECONDS;
        const token = signWidgetToken({
          sourceId: source.id,
          publicKey: source.publicKey,
          jti: randomUUID(),
          exp: expiresAt,
        });

        return successResponse({
          source: {
            publicKey: source.publicKey,
            type: source.type,
            name: source.name,
          },
          token,
          expiresAt,
          config: {
            requireCaptcha: isCaptchaRequired(source.config as Record<string, unknown> | null | undefined),
          },
        });
      } catch (error) {
        set.status = 500;
        return internalErrorResponse(error, { route: "GET /feedback/widget/bootstrap" }, "Failed to bootstrap widget");
      }
    },
    {
      query: t.Object({
        publicKey: t.String(),
      }),
    }
  )
  .post(
    "/ingest",
    async ({ body, request, set }) => {
      try {
        const source = await getFeedbackSourceByPublicKey(body.publicKey);
        if (!source) {
          set.status = 404;
          return errorResponse("Feedback source not found", 404);
        }

        const ip = getClientIp(request);
        const origin = request.headers.get("origin");
        if (!isAllowedOrigin(origin, source.allowedDomains)) {
          set.status = 403;
          return errorResponse("Origin is not allowed", 403);
        }

        const sourceContext = resolveSourceOwnershipContext(
          source.config as PublicFeedbackSourceConfig | null | undefined
        );
        if (!sourceContext.workspaceId) {
          set.status = 409;
          return errorResponse(
            "Feedback source is not configured with a workspace",
            409
          );
        }

        const verifiedToken = verifyWidgetToken(body.token);
        if (
          !verifiedToken ||
          verifiedToken.sourceId !== source.id ||
          verifiedToken.publicKey !== source.publicKey
        ) {
          set.status = 401;
          return errorResponse("Invalid or expired widget token", 401);
        }

        const rateLimitKey = `${ip}:${source.id}`;
        if (!allowIngestByRateLimit(rateLimitKey)) {
          logger.warn({ ip, sourceId: source.id }, "Feedback ingest blocked by rate limit");
          set.status = 429;
          return errorResponse("Rate limit exceeded", 429);
        }

        if (isCaptchaRequired(source.config as Record<string, unknown> | null | undefined)) {
          const captchaResult = await verifyHCaptcha(body.captchaToken, ip);
          if (!captchaResult.ok) {
            set.status = 400;
            return errorResponse(captchaResult.reason, 400);
          }
        }

        const dedupeKey = buildDedupeKey({
          sourceId: source.id,
          message: body.message,
          email: body.email,
          pageUrl: body.pageUrl,
          locale: body.locale,
        });

        const recentDuplicate = await findRecentFeedbackByDedupeKey(
          source.id,
          dedupeKey,
          env.FEEDBACK_INGEST_DEDUPE_WINDOW_SECONDS
        );

        if (recentDuplicate) {
          set.status = 409;
          return errorResponse("Duplicate feedback detected", 409);
        }

        const title = body.message.trim().slice(0, 120);
        const item = await createFeedbackItemWithPipeline({
          sourceId: source.id,
          clusterId: null,
          status: "new",
          category: normalizeFeedbackCategory(body.category),
          title,
          content: body.message.trim(),
          authorName: null,
          authorEmail: body.email?.trim().toLowerCase() ?? null,
          authorMeta: {},
          sentiment: null,
          metadata: {
            dedupeKey,
            pageUrl: body.pageUrl,
            locale: body.locale,
            workspaceId: sourceContext.workspaceId,
            // projectId is hard-bound to the Almirant project at the column
            // level (see feedback-item-service), so no longer carried in metadata.
            userAgent: request.headers.get("user-agent"),
            origin,
            ip,
          },
          promotedWorkItemId: null,
        });

        broadcastFeedbackItemCreated({
          item,
          workspaceId: sourceContext.workspaceId,
        });

        set.status = 201;
        return successResponse({
          id: item.id,
          status: item.status,
          createdAt: item.createdAt,
        });
      } catch (error) {
        set.status = 500;
        return internalErrorResponse(error, { route: "POST /feedback/ingest" }, "Failed to ingest feedback");
      }
    },
    {
      // NOTE: projectId is hard-bound to the Almirant project via
      // getAlmirantProjectId() in feedback-item-service — do not accept
      // it from the client body.
      body: t.Object({
        publicKey: t.String(),
        token: t.String(),
        message: t.String({ minLength: 1, maxLength: 5000 }),
        category: t.Optional(t.String()),
        email: t.Optional(t.String()),
        pageUrl: t.Optional(t.String()),
        locale: t.Optional(t.String()),
        captchaToken: t.Optional(t.String()),
      }),
    }
  );

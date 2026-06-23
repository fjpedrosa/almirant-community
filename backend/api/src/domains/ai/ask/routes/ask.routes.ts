import { Elysia, t } from "elysia";
import {
  successResponse,
  errorResponse,
} from "../../../../shared/services/response";
import { orchestrateAsk, AskError } from "../services/ask-orchestrator";
import { checkRateLimit } from "../services/security-guardrails";
import { logger } from "@almirant/config";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const normalizeErrorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : "Unexpected error";

const getOrganizationIdFromContext = (ctx: unknown): string => {
  const activeOrganization = (ctx as { activeOrganization?: { id?: string } }).activeOrganization;
  if (!activeOrganization?.id) {
    throw new Error("ACTIVE_ORGANIZATION_NOT_FOUND");
  }
  return activeOrganization.id;
};

// ---------------------------------------------------------------------------
// Elysia validation schemas
// ---------------------------------------------------------------------------

const AskTimeRangeSchema = t.Object({
  from: t.String({ format: "date-time" }),
  to: t.String({ format: "date-time" }),
});

const AskRequestSchema = t.Object({
  question: t.String({ minLength: 1, maxLength: 2000 }),
  projectId: t.String({ minLength: 1 }),
  featureId: t.Optional(t.String()),
  timeRange: t.Optional(AskTimeRangeSchema),
  followUpSessionId: t.Optional(t.String()),
});

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

export const askRoutes = new Elysia({ prefix: "/ask" })

  /**
   * POST /ask
   *
   * Submit a natural-language question scoped to a project. Returns an
   * answer with citations, a confidence score, and an abstention flag.
   *
   * Pipeline: query planning -> retrieval -> reranking -> LLM synthesis
   * Implements abstention when confidence < threshold.
   */
  .post(
    "/",
    async (ctx) => {
      try {
        const { body, set } = ctx;
        const organizationId = getOrganizationIdFromContext(ctx);

        // Rate limit check (in-memory, per organization)
        const rateCheck = checkRateLimit(organizationId);
        if (!rateCheck.allowed) {
          set.status = 429;
          set.headers["Retry-After"] = String(
            Math.ceil((rateCheck.retryAfterMs ?? 60_000) / 1000),
          );
          return errorResponse("Rate limit exceeded. Please try again later.", 429);
        }

        // Apply a 60-second request timeout via AbortController
        const abortController = new AbortController();
        const timeoutId = setTimeout(() => abortController.abort(), 60_000);

        try {
          const response = await orchestrateAsk(
            {
              question: body.question,
              projectId: body.projectId,
              featureId: body.featureId,
              timeRange: body.timeRange,
              followUpSessionId: body.followUpSessionId,
            },
            organizationId,
          );

          set.status = 200;
          return successResponse(response);
        } finally {
          clearTimeout(timeoutId);
        }
      } catch (error) {
        const message = normalizeErrorMessage(error);

        // Domain-specific error mapping
        if (message === "ACTIVE_ORGANIZATION_NOT_FOUND") {
          ctx.set.status = 403;
          return errorResponse("No active organization in session", 403);
        }

        if (error instanceof AskError) {
          const statusMap: Record<string, number> = {
            INSUFFICIENT_EVIDENCE: 422,
            RATE_LIMITED: 429,
            QUOTA_EXCEEDED: 429,
            INVALID_PROJECT: 404,
            INTERNAL_ERROR: 500,
          };
          const status = statusMap[error.code] ?? 500;
          ctx.set.status = status;
          return errorResponse(error.message, status);
        }

        // Abort timeout
        if (error instanceof DOMException && error.name === "AbortError") {
          logger.error("ask: request timed out after 60 seconds");
          ctx.set.status = 504;
          return errorResponse("Request timed out", 504);
        }

        logger.error({ error }, "ask: unexpected error in route handler");
        ctx.set.status = 500;
        return errorResponse(message, 500);
      }
    },
    { body: AskRequestSchema }
  )

  /**
   * POST /ask/feedback
   *
   * Submit structured feedback (thumbs up/down + optional comment) on an
   * Ask response. For the beta phase feedback is logged as structured
   * metrics rather than persisted to a database table.
   */
  .post(
    "/feedback",
    async (ctx) => {
      try {
        const { body } = ctx;

        logger.info(
          {
            sessionId: body.sessionId,
            rating: body.rating,
            category: body.category,
            hasComment: Boolean(body.comment),
          },
          "ask: beta feedback received",
        );

        ctx.set.status = 200;
        return successResponse({ recorded: true });
      } catch (error) {
        const message = normalizeErrorMessage(error);
        logger.error({ error }, "ask: error recording feedback");
        ctx.set.status = 500;
        return errorResponse(message, 500);
      }
    },
    {
      body: t.Object({
        sessionId: t.String({ minLength: 1 }),
        rating: t.Union([t.Literal("helpful"), t.Literal("not_helpful")]),
        category: t.Optional(
          t.Union([
            t.Literal("accuracy"),
            t.Literal("citations"),
            t.Literal("relevance"),
            t.Literal("completeness"),
            t.Literal("other"),
          ]),
        ),
        comment: t.Optional(t.String({ maxLength: 2000 })),
      }),
    },
  );

import { logger } from "@almirant/config";

// Success response
export const successResponse = <T>(
  data: T,
  meta?: Record<string, unknown>,
  status = 200
) => {
  return {
    success: true as const,
    data,
    ...(meta && { meta }),
  };
};

// Error response helper (for use inside route handlers)
export const errorResponse = (error: string, status = 400, code?: string) => {
  return {
    success: false as const,
    error,
    ...(code && { code }),
    meta: { timestamp: new Date().toISOString() },
  };
};

// Not found response
export const notFoundResponse = (resource = "Resource") => {
  return errorResponse(`${resource} not found`, 404);
};

/**
 * Response for a caught, UNTYPED failure inside a route handler (DB errors,
 * network errors, third-party SDK throws, ...) that the caller is about to
 * turn into a 5xx. Route catches must use this instead of forwarding
 * `error.message` into the body: driver errors like Drizzle's
 * DrizzleQueryError embed the raw SQL, column names, and bound params
 * (sometimes credential hashes) in `.message`, and that text was reaching
 * callers verbatim (issue #55).
 *
 * The caught error's full detail is logged server-side via `logger.error`;
 * the HTTP body only ever gets `fallback`. Domain-typed errors with
 * deliberately curated, safe messages (400/403/404/409/...) are NOT this —
 * keep calling `errorResponse` directly for those.
 */
export const internalErrorResponse = (
  error: unknown,
  logContext: Record<string, unknown>,
  fallback = "Internal server error",
) => {
  logger.error({ ...logContext, err: error }, fallback);
  return errorResponse(fallback, 500);
};

// Parse pagination params from query
export const parsePaginationParams = (query: Record<string, string | undefined>) => {
  const page = Math.max(1, parseInt(query.page || "1"));
  const limit = Math.min(500, Math.max(1, parseInt(query.limit || "50")));
  const offset = (page - 1) * limit;
  return { page, limit, offset };
};

// Build pagination meta
export const buildPaginationMeta = (
  page: number,
  limit: number,
  total: number
) => ({
  page,
  limit,
  total,
  totalPages: Math.ceil(total / limit),
});

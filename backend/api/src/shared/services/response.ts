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

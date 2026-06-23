import { Elysia } from "elysia";

/**
 * Middleware that verifies the authenticated user has the "admin" role.
 * Must be used AFTER sessionAuthMiddleware + requireAuth so that `user` is
 * already resolved in the context.
 *
 * Returns 403 Forbidden when the user exists but lacks admin privileges.
 */
export const requireAdmin = new Elysia({ name: "require-admin" })
  .onBeforeHandle({ as: "scoped" }, (ctx) => {
    const user = (ctx as unknown as Record<string, unknown>).user as
      | { role: string }
      | null;

    if (!user || user.role !== "admin") {
      ctx.set.status = 403;
      return { success: false, error: "Forbidden: admin role required" };
    }
  });

import { Elysia } from "elysia";

/**
 * Guard that enforces `user.role === "admin"`.
 * Must be mounted AFTER `requireAuth` so that `user` is guaranteed non-null.
 * Derives `{ admin }` — an alias of `user` — for downstream handlers.
 */
export const requireAdmin = new Elysia({ name: "require-admin" })
  .onBeforeHandle({ as: "scoped" }, (ctx) => {
    const user = (ctx as unknown as Record<string, unknown>).user as
      | { role: string }
      | null;

    if (!user || user.role !== "admin") {
      ctx.set.status = 403;
      return { success: false, error: "Admin access required" };
    }
  })
  .derive({ as: "scoped" }, (ctx) => {
    const user = (ctx as unknown as Record<string, unknown>).user;
    return { admin: user };
  });

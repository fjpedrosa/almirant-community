import { Elysia } from "elysia";
import { successResponse } from "../../../shared/services/response";

/**
 * GET /verify — returns the authenticated admin user's basic profile.
 * By the time this handler runs, sessionAuthMiddleware + requireAuth +
 * requireAdmin have already validated the request.
 */
export const adminVerifyRoute = new Elysia()
  .get("/verify", (ctx) => {
    const user = (ctx as unknown as Record<string, unknown>).user as {
      id: string;
      name: string;
      email: string;
      role: string;
    };

    return successResponse({
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
    });
  });

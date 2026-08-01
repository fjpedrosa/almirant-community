import { Elysia } from "elysia";
import * as Sentry from "@sentry/bun";
import { logger } from "@almirant/config";

export const errorMiddleware = new Elysia({ name: "error-middleware" })
  // `as: "global"` is load-bearing: Elysia's default onError scope is
  // "local", meaning it only fires for errors thrown by routes defined
  // directly on THIS instance. Since errorMiddleware has none of its own
  // routes (every domain route is mounted elsewhere via `.use()`), an
  // unscoped onError here never actually runs for the rest of the app —
  // any uncaught error (e.g. a DrizzleQueryError thrown from a `.derive()`
  // auth check) falls through to Elysia's built-in fallback, which
  // serializes `error.message` — raw SQL, column names, bound params,
  // sometimes credential hashes — directly as the plain-text response body.
  .onError({ as: "global" }, ({ code, error, set, request }) => {
    const timestamp = new Date().toISOString();
    const pathname = new URL(request.url).pathname;
    const method = request.method;

    switch (code) {
      case "VALIDATION":
        set.status = 400;
        logger.error({ err: error, method, path: pathname }, "Validation error");
        return {
          success: false,
          error: error.message,
          meta: { timestamp },
        };
      case "NOT_FOUND":
        set.status = 404;
        logger.info({ method, path: pathname }, "Not found");
        return {
          success: false,
          error: "Not found",
          meta: { timestamp },
        };
      default: {
        const msg = "message" in error ? error.message : String(error);
        logger.error({ err: error, method, path: pathname }, msg);
        Sentry.captureException(error, {
          tags: { method, pathname },
        });
        set.status = 500;
        return {
          success: false,
          error: "Internal server error",
          meta: { timestamp },
        };
      }
    }
  });

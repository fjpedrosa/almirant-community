import { Elysia } from "elysia";
import * as Sentry from "@sentry/bun";
import { logger } from "@almirant/config";

export const errorMiddleware = new Elysia({ name: "error-middleware" })
  .onError(({ code, error, set, request }) => {
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

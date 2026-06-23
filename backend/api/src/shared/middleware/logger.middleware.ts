import { Elysia } from "elysia";
import { colorMethod, colorStatus, colorDuration } from "@almirant/config";

const SILENT_PATHS = new Set(["/health", "/ready"]);

export const loggerMiddleware = new Elysia({ name: "logger-middleware" })
  .derive(() => ({ startTime: Date.now() }))
  .onAfterResponse(({ request, startTime, set }) => {
    const pathname = new URL(request.url).pathname;
    if (SILENT_PATHS.has(pathname)) return;

    const duration = Date.now() - startTime;
    const status = typeof set.status === "number" ? set.status : 200;

    console.log(
      `${colorMethod(request.method)} ${pathname} ${colorStatus(status)} ${colorDuration(duration)}`
    );
  });

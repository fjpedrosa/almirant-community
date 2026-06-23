/**
 * Elysia plugin that generates/propagates a request-scoped traceId.
 *
 * - Reads X-Trace-Id header from the incoming request
 * - Generates a fresh UUID if the header is absent
 * - Exposes ctx.traceId for route handlers
 * - Sets X-Trace-Id on the response so callers can forward it
 *
 * W3C semantics: one traceId per causal flow.
 * The client does NOT generate traceIds by default — the backend generates them.
 * For WS-initiated flows, traceId is set in the WS message handler using runWithTraceId().
 */

import { Elysia } from "elysia";
import { randomUUID } from "crypto";

export const traceIdPlugin = new Elysia({ name: "trace-id" })
  .derive({ as: "global" }, ({ request, set }) => {
    const incoming = request.headers.get("x-trace-id");
    const traceId = incoming || randomUUID();

    // Write to response so callers can read and forward it in subsequent requests
    set.headers["x-trace-id"] = traceId;

    return { traceId };
  });

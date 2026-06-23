import { Elysia } from "elysia";
import { db, sql } from "@almirant/database";
import { successResponse, errorResponse } from "../../../shared/services/response";

/**
 * Health check routes for service monitoring
 *
 * These endpoints are used by the health check processor to verify
 * service availability and performance. Each endpoint has a specific purpose:
 *
 * - GET /health         → General status (uptime, timestamp)
 * - GET /health/live    → Liveness probe (always 200 if service is running)
 * - GET /health/ready   → Readiness probe (checks dependencies like database)
 */
export const healthRoutes = new Elysia({ prefix: "/health" })
  /**
   * General health status endpoint
   * Returns basic service information and uptime
   *
   * Used by: Monitoring dashboards, load balancers
   * Response time: < 10ms (no external calls)
   */
  .get("/", () => {
    return successResponse({
      status: "ok",
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
    });
  })

  /**
   * Liveness probe endpoint
   * Indicates if the service process is alive
   *
   * Used by: Kubernetes liveness probes, health check processors
   * Response time: < 5ms (immediate response)
   * Note: Always returns 200 if this endpoint is reached
   */
  .get("/live", () => {
    return successResponse({
      status: "alive",
    });
  })

  /**
   * Readiness probe endpoint
   * Checks if the service is ready to handle requests
   * Verifies database connectivity
   *
   * Used by: Kubernetes readiness probes, load balancers, health check processors
   * Response time: < 100ms (includes database ping)
   * Status codes:
   *   - 200: Ready (database connected)
   *   - 503: Not ready (database disconnected)
   */
  .get("/ready", async ({ set }) => {
    try {
      const startTime = Date.now();

      // Test database connectivity with a simple query
      await db.execute(sql`SELECT 1`);

      const latencyMs = Date.now() - startTime;

      return successResponse(
        {
          status: "ready",
          services: {
            postgresql: "connected",
          },
          latencyMs,
        },
        { timestamp: new Date().toISOString() }
      );
    } catch (error) {
      set.status = 503;

      const message =
        error instanceof Error ? error.message : "Connection failed";

      return errorResponse(
        `Service not ready: ${message}`,
        503
      );
    }
  });

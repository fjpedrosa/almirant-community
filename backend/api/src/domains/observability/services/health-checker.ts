import { db, sql } from "@almirant/database/client";
import { insertHealthChecks } from "@almirant/database";
import { env } from "@almirant/config";
import type { NewHealthCheckRecord } from "@almirant/database/schema/health";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface HealthCheckResult {
  serviceName: "api" | "database" | "vps";
  status: "healthy" | "degraded" | "down";
  latencyMs: number;
  message: string | null;
}

// ---------------------------------------------------------------------------
// VPS health check via TCP connect to port 22
// ---------------------------------------------------------------------------

const VPS_CONNECT_TIMEOUT_MS = 5_000;

const checkVps = async (host: string): Promise<HealthCheckResult> => {
  const start = performance.now();

  try {
    const connected = await new Promise<boolean>((resolve) => {
      const timeout = setTimeout(() => resolve(false), VPS_CONNECT_TIMEOUT_MS);

      Bun.connect({
        hostname: host,
        port: 22,
        socket: {
          data() {},
          open(socket) {
            clearTimeout(timeout);
            socket.end();
            resolve(true);
          },
          error() {
            clearTimeout(timeout);
            resolve(false);
          },
          close() {},
          connectError() {
            clearTimeout(timeout);
            resolve(false);
          },
        },
      }).catch(() => {
        clearTimeout(timeout);
        resolve(false);
      });
    });

    const latencyMs = Math.round(performance.now() - start);

    if (!connected) {
      return {
        serviceName: "vps",
        status: "down",
        latencyMs,
        message: `TCP connect to ${host}:22 timed out or refused`,
      };
    }

    let status: HealthCheckResult["status"] = "healthy";
    if (latencyMs > 2000) status = "down";
    else if (latencyMs > 500) status = "degraded";

    return {
      serviceName: "vps",
      status,
      latencyMs,
      message: null,
    };
  } catch (error) {
    return {
      serviceName: "vps",
      status: "down",
      latencyMs: Math.round(performance.now() - start),
      message: error instanceof Error ? error.message : "VPS health check failed",
    };
  }
};

// ---------------------------------------------------------------------------
// Health check functions
// ---------------------------------------------------------------------------

/**
 * Run health checks for all services (API self-check + database + VPS),
 * then persist the results.
 */
export const runHealthChecks = async (): Promise<HealthCheckResult[]> => {
  const results: HealthCheckResult[] = [];

  // API self-check (measures execution overhead)
  const apiStart = performance.now();
  try {
    // Simple self-check: if we can run this code, the API is alive
    const apiLatency = Math.round(performance.now() - apiStart);
    results.push({
      serviceName: "api",
      status: apiLatency > 1000 ? "degraded" : "healthy",
      latencyMs: apiLatency,
      message: null,
    });
  } catch (error) {
    results.push({
      serviceName: "api",
      status: "down",
      latencyMs: Math.round(performance.now() - apiStart),
      message: error instanceof Error ? error.message : "API self-check failed",
    });
  }

  // Database check (SELECT 1)
  const dbStart = performance.now();
  try {
    await db.execute(sql`SELECT 1`);
    const dbLatency = Math.round(performance.now() - dbStart);
    results.push({
      serviceName: "database",
      status: dbLatency > 2000 ? "degraded" : "healthy",
      latencyMs: dbLatency,
      message: null,
    });
  } catch (error) {
    results.push({
      serviceName: "database",
      status: "down",
      latencyMs: Math.round(performance.now() - dbStart),
      message: error instanceof Error ? error.message : "Database check failed",
    });
  }

  // VPS check (TCP connect to port 22) — only when a VPS host is configured
  const vpsHost = env.VPS_HOST;
  if (vpsHost) {
    const vpsResult = await checkVps(vpsHost);
    results.push(vpsResult);
  }

  // Persist results
  const now = new Date();
  const checks: NewHealthCheckRecord[] = results.map((r) => ({
    serviceName: r.serviceName,
    status: r.status,
    latencyMs: r.latencyMs,
    message: r.message,
    checkedAt: now,
  }));

  try {
    await insertHealthChecks(checks);
  } catch {
    // If we cannot persist, still return the results to the caller
  }

  return results;
};

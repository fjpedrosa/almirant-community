import { createApiClient } from "./api-client.js";

type HeartbeatConfig = {
  apiBaseUrl: string;
  apiKey: string;
  workerId: string;
  hostname: string;
  config: Record<string, unknown>;
  maxConcurrentAgents: number;
  intervalMs?: number;
};

export const startHeartbeat = (cfg: HeartbeatConfig, getActiveJobs: () => string[]) => {
  const intervalMs = cfg.intervalMs ?? 30_000;

  const client = createApiClient({ apiBaseUrl: cfg.apiBaseUrl, apiKey: cfg.apiKey });
  let stopped = false;
  let timer: ReturnType<typeof setInterval> | null = null;

  const tick = () => {
    if (stopped) return;
    client.sendHeartbeat({
      workerId: cfg.workerId,
      hostname: cfg.hostname,
      config: cfg.config,
      activeJobs: getActiveJobs(),
      maxConcurrentAgents: cfg.maxConcurrentAgents,
    }).catch(() => {
      // Silent retry: do not crash the worker on transient network errors.
    });
  };

  // Fire once immediately.
  tick();
  timer = setInterval(tick, intervalMs);

  return () => {
    stopped = true;
    if (timer) clearInterval(timer);
    timer = null;
  };
};

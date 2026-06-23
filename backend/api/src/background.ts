import { env, logger } from "@almirant/config";
import { startStaleJobRecovery } from "./domains/agents/services/stale-job-recovery";
import { startInteractionTimeoutSweeper } from "./domains/observability/services/interaction-timeout-sweeper";
import { startPlanningSessionIdleSweeper } from "./domains/ideation/planning-sessions/services/planning-session-idle-sweeper";
import { quotaService } from "./domains/billing/quota/services/quota-service-instance";
import { startUsageReconciliation } from "./domains/billing/quota/services/usage-reconciliation";
import { startNotificationSweeper } from "./domains/notifications/services/notification-sweeper";
import { startAgentJobLogsSweeper } from "./domains/agents/services/agent-job-logs-sweeper";
import { startHealthCheckSweeper } from "./domains/observability/services/health-check-sweeper";
import { startUsageAggregation } from "./domains/billing/quota/services/usage-aggregation";
import { startWsPubSubSubscriber } from "./shared/ws/ws-pubsub-subscriber";
import { wsConnectionManager } from "./shared/ws/ws-connection-manager";
import { startMemoryGcSweeper } from "./domains/agents/services/memory-gc-sweeper";

interface BackgroundJobHandles {
  stop: () => Promise<void>;
}

export const startBackgroundJobs = (): BackgroundJobHandles => {
  const stopStaleJobRecovery = startStaleJobRecovery({
    intervalMs: 120_000,
    offlineThresholdMs: 90_000,
  });
  const stopInteractionTimeoutSweeper = startInteractionTimeoutSweeper({
    intervalMs: 30_000,
  });
  const stopPlanningSessionIdleSweeper = startPlanningSessionIdleSweeper({
    intervalMs: 60_000,
  });
  const stopQuotaService = quotaService.stop;
  const stopUsageReconciliation = startUsageReconciliation({
    intervalMs: 300_000,
  });
  const stopNotificationSweeper = startNotificationSweeper({
    intervalMs: 30_000,
  });
  const stopAgentJobLogsSweeper = startAgentJobLogsSweeper({
    intervalMs: env.AGENT_JOB_LOG_SWEEPER_INTERVAL_MS,
    retentionDays: env.AGENT_JOB_LOG_RETENTION_DAYS,
    batchSize: env.AGENT_JOB_LOG_SWEEPER_BATCH_SIZE,
  });
  const stopHealthCheckSweeper = startHealthCheckSweeper({
    intervalMs: env.HEALTH_CHECK_INTERVAL_MS,
  });
  const stopUsageAggregation = startUsageAggregation({ intervalMs: 600_000 });
  const stopMemoryGcSweeper = startMemoryGcSweeper();
  const stopWsPubSub = env.REDIS_URL
    ? startWsPubSubSubscriber({
        redisUrl: env.REDIS_URL,
        channel: env.WS_PUBSUB_CHANNEL,
      })
    : null;
  wsConnectionManager.startSweepInterval();

  logger.info("Background jobs started");

  return {
    stop: async () => {
      stopStaleJobRecovery();
      stopInteractionTimeoutSweeper();
      stopPlanningSessionIdleSweeper();
      stopQuotaService();
      stopUsageReconciliation();
      stopNotificationSweeper();
      stopAgentJobLogsSweeper();
      stopHealthCheckSweeper();
      stopUsageAggregation();
      stopMemoryGcSweeper();
      wsConnectionManager.stopSweepInterval();
      await wsConnectionManager.stopPubSubPublisher();
      if (stopWsPubSub) await stopWsPubSub();
    },
  };
};

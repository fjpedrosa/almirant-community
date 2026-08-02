import { randomUUID } from "node:crypto";
import { env, logger } from "@almirant/config";
import {
  claimAgentOutputDeliveries,
  completeAgentOutputDelivery,
  failAgentOutputDelivery,
  findUnreconciledTerminalAgentOutputJobs,
  findUnreconciledTerminalScheduledAgentJobIds,
} from "@almirant/database";
import { decrypt } from "../../../shared/services/encryption";
import { createSafeOutboundFetch } from "../../../shared/services/outbound-http-policy";
import {
  createAgentOutputDeliverySweeper,
  type ClaimedAgentOutputDelivery,
} from "./agent-output-delivery-sweeper";
import { reconcileTerminalScheduledAgentJob } from "./scheduled-agent-terminal-runtime";
import { createScheduledAgentTerminalSweeper } from "./scheduled-agent-terminal-sweeper";

const safeFetch = createSafeOutboundFetch({
  timeoutMs: 10_000,
  maxRequestBodyBytes: 2 * 1024 * 1024,
  maxResponseBodyBytes: 64 * 1024,
});

const decryptRecord = (
  encrypted: string,
  iv: string,
  authTag: string,
): Record<string, unknown> => {
  if (!env.ENCRYPTION_KEY) {
    throw new Error("Agent output encryption key is unavailable");
  }
  const parsed = JSON.parse(
    decrypt(encrypted, iv, authTag, env.ENCRYPTION_KEY),
  ) as unknown;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Agent output secret is not an object");
  }
  return parsed as Record<string, unknown>;
};

export const runAgentOutputDeliverySweepOnce = async () => {
  // Do not claim work when the key is unavailable. Leaving rows pending is
  // recoverable; dead-lettering due to a deployment misconfiguration is not.
  if (!env.ENCRYPTION_KEY) {
    throw new Error("Agent output encryption key is unavailable");
  }
  const leaseOwner = `agent-output:${randomUUID()}`;
  const sweeper = createAgentOutputDeliverySweeper({
    claim: async (options) =>
      (await claimAgentOutputDeliveries(
        options,
      )) as unknown as ClaimedAgentOutputDelivery[],
    decrypt: decryptRecord,
    safeFetch,
    complete: completeAgentOutputDelivery,
    fail: failAgentOutputDelivery,
  });
  return sweeper.sweep({
    leaseOwner,
    leaseMs: 60_000,
    limit: 25,
  });
};

export const runScheduledAgentTerminalSweepOnce = async (): Promise<{
  pending: number;
  reconciled: number;
}> => {
  const sweeper = createScheduledAgentTerminalSweeper({
    findOutputCandidates: findUnreconciledTerminalAgentOutputJobs,
    findRunCandidates: findUnreconciledTerminalScheduledAgentJobIds,
    reconcile: reconcileTerminalScheduledAgentJob,
    onError: (jobId, error) => {
      logger.error(
        { error, jobId },
        "Failed to reconcile terminal scheduled agent job",
      );
    },
  });
  return sweeper.sweep({ limit: 25 });
};

const startSweep = (
  intervalMs: number,
  sweep: () => Promise<unknown>,
  label: string,
): (() => void) => {
  const safeInterval = Math.max(intervalMs, 10_000);
  let stopped = false;
  let running = false;
  const tick = async () => {
    if (stopped || running) return;
    running = true;
    try {
      await sweep();
    } catch (error) {
      logger.error({ error }, `${label} failed; will retry`);
    } finally {
      running = false;
    }
  };
  const startup = setTimeout(() => void tick(), 5_000);
  const interval = setInterval(() => void tick(), safeInterval);
  return () => {
    stopped = true;
    clearTimeout(startup);
    clearInterval(interval);
  };
};

export const startAgentOutputDeliverySweeper = (
  intervalMs = 30_000,
): (() => void) =>
  startSweep(
    intervalMs,
    runAgentOutputDeliverySweepOnce,
    "Agent output delivery sweep",
  );

export const startScheduledAgentTerminalSweeper = (
  intervalMs = 30_000,
): (() => void) =>
  startSweep(
    intervalMs,
    runScheduledAgentTerminalSweepOnce,
    "Scheduled agent terminal sweep",
  );

import { isIP } from "node:net";
import type { ClaimedJob } from "@almirant/remote-agent";
import { normalizeJobConfig } from "../shared/job-helpers";
import { resolveDeliveryGitIdentity } from "../delivery/github-identity";

export const AGENT_NO_PROXY = "127.0.0.1,localhost,::1";

const SAFE_NETWORK_NAME = /^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,127}$/;
const SAFE_PROXY_HOSTNAME = /^[a-z0-9](?:[a-z0-9.-]{0,251}[a-z0-9])?$/i;
const FORBIDDEN_NETWORK_NAMES = new Set([
  "bridge",
  "default",
  "host",
  "none",
  "runner-internal",
  "almirant-prod",
]);
const CONTROL_PLANE_NAME = /(^|[-_.])(backend|database|db|docker-proxy|postgres|redis)([-_.]|$)/i;

export type AgentEgressPolicy = {
  networkName: string;
  proxyUrl: string;
  proxyHostname: string;
  noProxy: string;
  untrusted: boolean;
};

export type AgentEgressPolicyConfig = {
  networkName?: string;
  proxyUrl?: string;
};

/**
 * A job is untrusted when a trusted-delivery identity is in play or the job
 * config carries an explicit trust marker. Community has no trusted-delivery
 * workflow yet (see ../delivery/github-identity), so the first condition is
 * currently always false — this keeps the seam wired for when it lands.
 */
export const isUntrustedAgentJob = (job: ClaimedJob): boolean => {
  const config = normalizeJobConfig(job);
  const deliveryGitIdentity = resolveDeliveryGitIdentity(config);
  return (
    deliveryGitIdentity.trustedSiteBuild ||
    config.untrusted === true ||
    config.trustLevel === "untrusted" ||
    config.inputTrust === "untrusted"
  );
};

const requireConfiguredValue = (
  value: string | undefined,
  variable: "AGENT_EGRESS_NETWORK" | "AGENT_EGRESS_PROXY_URL",
  untrusted: boolean,
): string => {
  if (typeof value === "string" && value.trim().length > 0) return value.trim();
  const jobKind = untrusted ? "Untrusted agent job" : "Docker agent job";
  throw new Error(`${jobKind} requires ${variable}; refusing unsafe network fallback`);
};

const validateNetworkName = (networkName: string): void => {
  const normalized = networkName.toLowerCase();
  if (
    !SAFE_NETWORK_NAME.test(networkName) ||
    FORBIDDEN_NETWORK_NAMES.has(normalized) ||
    normalized.endsWith("_default") ||
    normalized.endsWith("-default") ||
    CONTROL_PLANE_NAME.test(normalized)
  ) {
    throw new Error(`Unsafe agent egress network: ${networkName}`);
  }
};

const validateProxyUrl = (rawProxyUrl: string): URL => {
  let proxy: URL;
  try {
    proxy = new URL(rawProxyUrl);
  } catch {
    throw new Error("Unsafe agent egress proxy: URL is invalid");
  }

  const hostname = proxy.hostname.toLowerCase();
  const port = Number(proxy.port);
  if (
    proxy.protocol !== "http:" ||
    proxy.username.length > 0 ||
    proxy.password.length > 0 ||
    proxy.pathname !== "/" ||
    proxy.search.length > 0 ||
    proxy.hash.length > 0 ||
    proxy.port.length === 0 ||
    !Number.isInteger(port) ||
    port < 1 ||
    port > 65_535 ||
    !SAFE_PROXY_HOSTNAME.test(hostname) ||
    isIP(hostname) !== 0 ||
    hostname === "localhost" ||
    hostname === "host.docker.internal" ||
    CONTROL_PLANE_NAME.test(hostname)
  ) {
    throw new Error("Unsafe agent egress proxy: expected a credential-free HTTP service alias and explicit port");
  }

  return proxy;
};

/**
 * Resolve the only network/proxy pair an agent may receive. There is no
 * auto-detection and no Docker default-network fallback: deployments must
 * provide both values explicitly.
 */
export const resolveAgentEgressPolicy = (
  job: ClaimedJob,
  config: AgentEgressPolicyConfig,
): AgentEgressPolicy => {
  const untrusted = isUntrustedAgentJob(job);
  const networkName = requireConfiguredValue(
    config.networkName,
    "AGENT_EGRESS_NETWORK",
    untrusted,
  );
  const rawProxyUrl = requireConfiguredValue(
    config.proxyUrl,
    "AGENT_EGRESS_PROXY_URL",
    untrusted,
  );

  validateNetworkName(networkName);
  const proxy = validateProxyUrl(rawProxyUrl);

  return {
    networkName,
    proxyUrl: proxy.toString(),
    proxyHostname: proxy.hostname,
    noProxy: AGENT_NO_PROXY,
    untrusted,
  };
};

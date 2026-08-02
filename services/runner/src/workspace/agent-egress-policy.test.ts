import { describe, expect, it } from "bun:test";
import type { ClaimedJob } from "@almirant/remote-agent";
import {
  isUntrustedAgentJob,
  resolveAgentEgressPolicy,
} from "./agent-egress-policy";

const createJob = (config: Record<string, unknown> = {}): ClaimedJob => ({
  id: "job-1",
  workItemId: null,
  projectId: null,
  boardId: null,
  createdByUserId: null,
  workspaceId: null,
  jobType: "implementation",
  provider: "zipu",
  priority: "medium",
  status: "queued",
  retryCount: 0,
  maxRetries: 0,
  availableAt: null,
  config,
});

describe("agent egress policy", () => {
  it("classifies a job with an explicit untrusted marker as untrusted", () => {
    expect(isUntrustedAgentJob(createJob({ untrusted: true }))).toBe(true);
    expect(isUntrustedAgentJob(createJob({ trustLevel: "untrusted" }))).toBe(true);
    expect(isUntrustedAgentJob(createJob({ inputTrust: "untrusted" }))).toBe(true);
    expect(isUntrustedAgentJob(createJob())).toBe(false);
  });

  it("fails closed for an untrusted job when the network or proxy is absent", () => {
    const job = createJob({ untrusted: true });

    expect(() =>
      resolveAgentEgressPolicy(job, {
        networkName: undefined,
        proxyUrl: "http://egress-proxy:3128",
      }),
    ).toThrow("requires AGENT_EGRESS_NETWORK");

    expect(() =>
      resolveAgentEgressPolicy(job, {
        networkName: "almirant-agent-egress",
        proxyUrl: undefined,
      }),
    ).toThrow("requires AGENT_EGRESS_PROXY_URL");
  });

  it("fails closed for an ordinary job when the network or proxy is absent", () => {
    expect(() =>
      resolveAgentEgressPolicy(createJob(), {
        networkName: undefined,
        proxyUrl: "http://egress-proxy:3128",
      }),
    ).toThrow("requires AGENT_EGRESS_NETWORK");

    expect(() =>
      resolveAgentEgressPolicy(createJob(), {
        networkName: "almirant-agent-egress",
        proxyUrl: undefined,
      }),
    ).toThrow("requires AGENT_EGRESS_PROXY_URL");
  });

  it.each([
    "bridge",
    "default",
    "host",
    "none",
    "runner-internal",
    "almirant-prod",
    "project_default",
  ])("rejects control-plane or Docker fallback network %s", (networkName) => {
    expect(() =>
      resolveAgentEgressPolicy(createJob(), {
        networkName,
        proxyUrl: "http://egress-proxy:3128",
      }),
    ).toThrow("Unsafe agent egress network");
  });

  it.each([
    "http://docker-proxy:2375",
    "http://backend:3001",
    "http://redis:6379",
    "http://localhost:3128",
    "http://user:password@egress-proxy:3128",
    "http://egress-proxy:3128/admin",
    "https://egress-proxy:3128?target=other",
  ])("rejects unsafe proxy endpoint %s", (proxyUrl) => {
    expect(() =>
      resolveAgentEgressPolicy(createJob(), {
        networkName: "almirant-agent-egress",
        proxyUrl,
      }),
    ).toThrow("Unsafe agent egress proxy");
  });

  it("returns an explicit proxy-only policy for a valid configuration", () => {
    expect(
      resolveAgentEgressPolicy(createJob(), {
        networkName: "almirant-agent-egress",
        proxyUrl: "http://egress-proxy:3128",
      }),
    ).toEqual({
      networkName: "almirant-agent-egress",
      proxyUrl: "http://egress-proxy:3128/",
      proxyHostname: "egress-proxy",
      noProxy: "127.0.0.1,localhost,::1",
      untrusted: false,
    });
  });

  it("keeps an untrusted job fail-closed and proxy-only", () => {
    const job = createJob({ untrusted: true });

    expect(
      resolveAgentEgressPolicy(job, {
        networkName: "almirant-agent-egress",
        proxyUrl: "http://egress-proxy:3128",
      }),
    ).toEqual({
      networkName: "almirant-agent-egress",
      proxyUrl: "http://egress-proxy:3128/",
      proxyHostname: "egress-proxy",
      noProxy: "127.0.0.1,localhost,::1",
      untrusted: true,
    });
  });
});

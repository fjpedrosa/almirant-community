import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const serviceBlock = (compose: string, service: string): string => {
  const match = compose.match(
    new RegExp(`^  ${service}:\\n([\\s\\S]*?)(?=^  [a-zA-Z0-9_-]+:|^networks:|^volumes:|(?![\\s\\S]))`, "m"),
  );
  if (!match) throw new Error(`Service ${service} not found`);
  return match[0];
};

const networkBlock = (compose: string, network: string): string => {
  const networks = compose.slice(compose.indexOf("\nnetworks:"));
  const match = networks.match(
    new RegExp(`^  ${network}:\\n([\\s\\S]*?)(?=^  [a-zA-Z0-9_-]+:|^volumes:|(?![\\s\\S]))`, "m"),
  );
  if (!match) throw new Error(`Network ${network} not found`);
  return match[0];
};

describe("production agent egress topology", () => {
  const rootCompose = readFileSync(
    resolve(import.meta.dir, "../../../../docker-compose.prod.yml"),
    "utf8",
  );
  const runnerCompose = readFileSync(
    resolve(import.meta.dir, "../../docker-compose.prod.yml"),
    "utf8",
  );
  const proxyCheck = readFileSync(
    resolve(import.meta.dir, "../../docker/pebble-egress-check.yaml"),
    "utf8",
  );
  const squidConfig = readFileSync(
    resolve(import.meta.dir, "../../docker/squid.conf"),
    "utf8",
  );

  it.each([
    ["full-stack", rootCompose],
    ["runner-stack", runnerCompose],
  ])("keeps the %s agent network internal and explicitly named", (_name, compose) => {
    const egressNetwork = networkBlock(compose, "agent-egress");
    expect(egressNetwork).toContain("internal: true");
    expect(egressNetwork).toContain("com.almirant.network.role: agent-egress");
    expect(egressNetwork).toContain("AGENT_EGRESS_NETWORK");
  });

  it.each([
    ["full-stack", rootCompose],
    ["runner-stack", runnerCompose],
  ])("keeps control-plane services off the %s agent network", (_name, compose) => {
    for (const service of ["docker-proxy", "backend", "redis", "runner"]) {
      if (!compose.includes(`  ${service}:`)) continue;
      expect(serviceBlock(compose, service)).not.toContain("- agent-egress");
    }
  });

  it.each([
    ["full-stack", rootCompose],
    ["runner-stack", runnerCompose],
  ])("places the %s runner on a separate internal agent-control network", (_name, compose) => {
    expect(serviceBlock(compose, "runner")).toContain("- agent-control");
    const controlNetwork = networkBlock(compose, "agent-control");
    expect(controlNetwork).toContain("internal: true");
    expect(controlNetwork).toContain("com.almirant.network.role: agent-control");
  });

  it.each([
    ["full-stack", rootCompose],
    ["runner-stack", runnerCompose],
  ])("exposes only the labelled Squid proxy as the %s egress gateway", (_name, compose) => {
    const proxy = serviceBlock(compose, "egress-proxy");
    expect(proxy).toContain(
      "ubuntu/squid:7.2-26.04_edge@sha256:ceec14e15ca37b18f19827d2ae6d86dd297bc161f78ced839b7d29b25724cc2c",
    );
    expect(proxy).toContain("com.almirant.network.role: egress-proxy");
    expect(proxy).toContain("- agent-egress");
    expect(proxy).toContain("squid.conf");
    expect(proxy).toContain("pebble-egress-check.yaml");
    expect(proxy).toContain('["CMD", "/usr/bin/pebble", "health"]');
  });

  it("health-gates the proxy on a Pebble TCP readiness check", () => {
    expect(proxyCheck).toContain("level: ready");
    expect(proxyCheck).toContain("port: 3128");
  });

  it("allows the exact OpenAI API and Codex subscription transport domains", () => {
    expect(squidConfig).toContain("acl allowed_domains dstdomain .openai.com");
    expect(squidConfig).toContain("acl allowed_domains dstdomain .chatgpt.com");
    expect(squidConfig).toContain("http_access deny blocked_destinations");
    expect(squidConfig).toContain("http_access allow allowed_domains\nhttp_access deny all");
  });
});

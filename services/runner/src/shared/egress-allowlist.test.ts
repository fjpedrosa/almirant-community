import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const squidConfig = readFileSync(
  resolve(import.meta.dir, "../../docker/squid.conf"),
  "utf8",
);

describe("agent egress allowlist", () => {
  it.each(["mcp.context7.com", "api.githubcopilot.com"])(
    "allows the official %s MCP endpoint",
    (hostname) => {
      expect(squidConfig).toContain(`acl allowed_domains dstdomain ${hostname}`);
    },
  );

  it("denies local, link-local, metadata, and private destinations before domain allows", () => {
    for (const range of [
      "10.0.0.0/8",
      "127.0.0.0/8",
      "169.254.0.0/16",
      "172.16.0.0/12",
      "192.168.0.0/16",
      "::1/128",
      "fc00::/7",
      "fe80::/10",
    ]) {
      expect(squidConfig).toContain(range);
    }

    const privateDeny = squidConfig.indexOf("http_access deny blocked_destinations");
    const domainAllow = squidConfig.indexOf("http_access allow allowed_domains");
    expect(privateDeny).toBeGreaterThan(-1);
    expect(privateDeny).toBeLessThan(domainAllow);
  });

  it("does not allow Docker or application control-plane service names", () => {
    for (const hostname of ["docker-proxy", "backend", "redis", "postgres"] ) {
      expect(squidConfig).not.toContain(`dstdomain ${hostname}`);
    }
    expect(squidConfig.trimEnd()).toEndWith("cache deny all");
    expect(squidConfig).toContain("http_access deny all");
  });
});

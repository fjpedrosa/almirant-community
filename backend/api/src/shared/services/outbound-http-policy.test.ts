import { describe, expect, it } from "bun:test";
import {
  OutboundResponseLimitError,
  OutboundUrlPolicyError,
  createSafeOutboundFetch,
  validateOutboundHttpUrl,
} from "./outbound-http-policy";
import { createServer } from "node:http";

const resolveTo = (...addresses: string[]) => async () =>
  addresses.map((address) => ({
    address,
    family: address.includes(":") ? (6 as const) : (4 as const),
  }));

describe("createSafeOutboundFetch — real pinned request (regression)", () => {
  // The other createSafeOutboundFetch tests inject a mock `performRequest`, so
  // the real `performPinnedHttpRequest` (and its custom DNS `lookup`) is never
  // exercised. Under Bun, that lookup is invoked with `{ all: true }` and the
  // legacy `(err, address, family)` callback form throws
  // `results.sort is not a function`, which every MCP connection test hit.
  // This drives the real request against a loopback server to guard it.
  it("completes a real pinned request against a loopback server", async () => {
    const prevEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = "test"; // loopback destinations are allowed only here
    const server = createServer((_req, res) => {
      res.writeHead(200, { "content-type": "application/json" });
      res.end('{"ok":true}');
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
    const addr = server.address();
    const port = typeof addr === "object" && addr ? addr.port : 0;

    try {
      const safeFetch = createSafeOutboundFetch(); // default (real) performRequest
      const response = await safeFetch(`http://127.0.0.1:${port}/`);
      expect(response.status).toBe(200);
      expect(await response.text()).toBe('{"ok":true}');
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
      process.env.NODE_ENV = prevEnv;
    }
  });
});

describe("validateOutboundHttpUrl", () => {
  it("accepts an HTTPS endpoint only after every DNS result is public", async () => {
    const result = await validateOutboundHttpUrl("https://mcp.example.com/path", {
      nodeEnv: "production",
      resolveHostname: resolveTo("93.184.216.34", "2606:2800:220:1:248:1893:25c8:1946"),
    });

    expect(result.url.toString()).toBe("https://mcp.example.com/path");
    expect(result.addresses).toHaveLength(2);
  });

  it.each([
    "127.0.0.1",
    "10.0.0.9",
    "172.16.10.1",
    "192.168.1.4",
    "169.254.169.254",
    "100.64.0.1",
    "192.0.2.1",
    "198.51.100.4",
    "203.0.113.9",
    "224.0.0.1",
    "::1",
    "fd00::1",
    "fe80::1",
    "2001:db8::1",
    "::ffff:127.0.0.1",
  ])("rejects non-public destination %s after DNS resolution", async (address) => {
    await expect(
      validateOutboundHttpUrl("https://mcp.example.com", {
        nodeEnv: "production",
        resolveHostname: resolveTo(address),
      }),
    ).rejects.toBeInstanceOf(OutboundUrlPolicyError);
  });

  it("fails closed when one DNS answer is private", async () => {
    await expect(
      validateOutboundHttpUrl("https://mcp.example.com", {
        nodeEnv: "production",
        resolveHostname: resolveTo("93.184.216.34", "10.0.0.4"),
      }),
    ).rejects.toThrow("public network destination");
  });

  it("fails closed when DNS resolution returns no addresses", async () => {
    await expect(
      validateOutboundHttpUrl("https://mcp.example.com", {
        nodeEnv: "production",
        resolveHostname: resolveTo(),
      }),
    ).rejects.toThrow("could not be resolved safely");
  });

  it("requires HTTPS in production and rejects embedded credentials", async () => {
    await expect(
      validateOutboundHttpUrl("http://93.184.216.34/mcp", { nodeEnv: "production" }),
    ).rejects.toThrow("HTTPS");

    await expect(
      validateOutboundHttpUrl("https://token@mcp.example.com", {
        nodeEnv: "production",
        resolveHostname: resolveTo("93.184.216.34"),
      }),
    ).rejects.toThrow("embedded credentials");
  });

  it("allows explicit loopback localhost only outside production", async () => {
    const result = await validateOutboundHttpUrl("http://localhost:3000/mcp", {
      nodeEnv: "test",
      resolveHostname: resolveTo("127.0.0.1", "::1"),
    });

    expect(result.isLocalDevelopment).toBe(true);

    await expect(
      validateOutboundHttpUrl("http://localhost:3000/mcp", {
        nodeEnv: "production",
        resolveHostname: resolveTo("127.0.0.1"),
      }),
    ).rejects.toBeInstanceOf(OutboundUrlPolicyError);
  });

  it("fails secure for staging or unknown runtime environment names", async () => {
    await expect(
      validateOutboundHttpUrl("http://localhost:3000/mcp", {
        nodeEnv: "staging",
        resolveHostname: resolveTo("127.0.0.1"),
      }),
    ).rejects.toThrow("HTTPS");
  });
});

describe("createSafeOutboundFetch", () => {
  it("disables redirects and applies a bounded request timeout", async () => {
    let capturedInit: RequestInit | undefined;
    const safeFetch = createSafeOutboundFetch({
      timeoutMs: 250,
      validateUrl: async (rawUrl) => ({
        url: new URL(rawUrl.toString()),
        addresses: [{ address: "93.184.216.34", family: 4 }],
        isLocalDevelopment: false,
      }),
      performRequest: async (_validated, init) => {
        capturedInit = init;
        return new Response(null, { status: 204 });
      },
    });

    const response = await safeFetch("https://mcp.example.com/mcp", { method: "POST" });

    expect(response.status).toBe(204);
    expect(capturedInit?.redirect).toBe("manual");
    expect(capturedInit?.signal).toBeInstanceOf(AbortSignal);
  });

  it("fails closed instead of following a redirect", async () => {
    const safeFetch = createSafeOutboundFetch({
      validateUrl: async (rawUrl) => ({
        url: new URL(rawUrl.toString()),
        addresses: [{ address: "93.184.216.34", family: 4 }],
        isLocalDevelopment: false,
      }),
      performRequest: async () =>
        new Response(null, {
          status: 302,
          headers: { location: "http://169.254.169.254/latest/meta-data" },
        }),
    });

    await expect(safeFetch("https://mcp.example.com/mcp")).rejects.toThrow(
      "redirects are not allowed",
    );
  });

  it("keeps the caller abort signal attached to streaming responses", async () => {
    const caller = new AbortController();
    let requestSignal: AbortSignal | null = null;
    const safeFetch = createSafeOutboundFetch({
      validateUrl: async (rawUrl) => ({
        url: new URL(rawUrl.toString()),
        addresses: [{ address: "93.184.216.34", family: 4 }],
        isLocalDevelopment: false,
      }),
      performRequest: async (_validated, init) => {
        requestSignal = init.signal ?? null;
        return new Response("event: ready\n\n", {
          headers: { "content-type": "text/event-stream" },
        });
      },
    });

    await safeFetch("https://mcp.example.com/mcp", { signal: caller.signal });
    caller.abort();

    expect((requestSignal as AbortSignal | null)?.aborted).toBe(true);
  });

  it("rejects an oversized response from Content-Length before reading it", async () => {
    const safeFetch = createSafeOutboundFetch({
      maxResponseBodyBytes: 4,
      validateUrl: async (rawUrl) => ({
        url: new URL(rawUrl.toString()),
        addresses: [{ address: "93.184.216.34", family: 4 }],
        isLocalDevelopment: false,
      }),
      performRequest: async () =>
        new Response("12345", { headers: { "content-length": "5" } }),
    });

    await expect(safeFetch("https://mcp.example.com/mcp")).rejects.toBeInstanceOf(
      OutboundResponseLimitError,
    );
  });

  it("supports an explicit 12 MiB media cap without widening the 4 MiB default", async () => {
    const safeFetch = createSafeOutboundFetch({
      maxResponseBodyBytes: 12 * 1024 * 1024,
      validateUrl: async (rawUrl) => ({
        url: new URL(rawUrl.toString()),
        addresses: [{ address: "93.184.216.34", family: 4 }],
        isLocalDevelopment: false,
      }),
      performRequest: async () =>
        new Response(null, {
          status: 200,
          headers: { "content-length": String(5 * 1024 * 1024) },
        }),
    });

    expect((await safeFetch("https://media.example.com/hero.webp")).status)
      .toBe(200);
  });

  it("streams within the cap and cancels as soon as chunked content exceeds it", async () => {
    let cancelled = false;
    const source = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode("123"));
        controller.enqueue(new TextEncoder().encode("456"));
      },
      cancel() {
        cancelled = true;
      },
    });
    const safeFetch = createSafeOutboundFetch({
      maxResponseBodyBytes: 4,
      validateUrl: async (rawUrl) => ({
        url: new URL(rawUrl.toString()),
        addresses: [{ address: "93.184.216.34", family: 4 }],
        isLocalDevelopment: false,
      }),
      performRequest: async () =>
        new Response(source, { headers: { "content-type": "text/event-stream" } }),
    });

    const response = await safeFetch("https://mcp.example.com/mcp");
    const reader = response.body!.getReader();
    const first = await reader.read();

    expect(new TextDecoder().decode(first.value)).toBe("123");
    await expect(reader.read()).rejects.toBeInstanceOf(OutboundResponseLimitError);
    expect(cancelled).toBe(true);
  });
});

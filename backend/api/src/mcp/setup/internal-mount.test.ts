import { Elysia } from "elysia";
import { describe, expect, it } from "bun:test";
import { disabledInternalMcpMount } from "./internal-mount";

describe("disabledInternalMcpMount", () => {
  it("returns 404 with an explicit message for POST /mcp/internal", async () => {
    const app = new Elysia().use(disabledInternalMcpMount);

    const res = await app.handle(
      new Request("http://localhost/mcp/internal", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} }),
      }),
    );

    expect(res.status).toBe(404);
    const body = (await res.json()) as { success: boolean; error: string };
    expect(body.success).toBe(false);
    expect(body.error).toContain("MCP_INTERNAL_ENABLED");
  });

  it("does NOT let /mcp/internal silently fall through to a sibling /mcp handler", async () => {
    // Reproduces the original bug: public /mcp handler returning 130 tools,
    // /mcp/internal unmounted — the guard must take precedence so clients
    // get a clear 404 instead of a fake "200 with only public tools".
    const app = new Elysia()
      .use(disabledInternalMcpMount)
      .post("/mcp", () => ({ toolCount: 130 }));

    const res = await app.handle(
      new Request("http://localhost/mcp/internal", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{}",
      }),
    );

    expect(res.status).toBe(404);
    const text = await res.text();
    expect(text).not.toContain("toolCount");
  });

  it("also 404s on GET so probes don't leak public metadata", async () => {
    const app = new Elysia().use(disabledInternalMcpMount);

    const res = await app.handle(
      new Request("http://localhost/mcp/internal", { method: "GET" }),
    );

    expect(res.status).toBe(404);
  });
});

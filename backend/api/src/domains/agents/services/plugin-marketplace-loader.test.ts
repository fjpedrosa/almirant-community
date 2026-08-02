import { describe, expect, it, mock } from "bun:test";
import {
  MarketplaceCatalogLoadError,
  createClaudeMarketplaceCatalogLoader,
} from "./plugin-marketplace-loader";
import { createSafeOutboundFetch } from "../../../shared/services/outbound-http-policy";

const catalog = JSON.stringify({
  name: "acme-plugins",
  owner: { name: "Acme" },
  plugins: [{ name: "review", source: "./plugins/review" }],
});

describe("Claude marketplace catalog loader", () => {
  it("loads and sanitizes a public HTTPS catalog with bounded redirects", async () => {
    const safeFetch = mock(async (url: string | URL) => {
      const value = String(url);
      if (value === "https://plugins.example.com/catalog.json") {
        return new Response(null, {
          status: 302,
          headers: { location: "https://cdn.example.com/catalog.json" },
        });
      }
      return new Response(catalog, {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    });
    const load = createClaudeMarketplaceCatalogLoader({
      safeFetch,
    });

    const result = await load("https://plugins.example.com/catalog.json");

    expect(result.catalog.name).toBe("acme-plugins");
    expect(result.catalog.plugins[0]?.externalId).toBe("review");
    expect(result.source.cliSource).toBe("https://plugins.example.com/catalog.json");
    expect(safeFetch).toHaveBeenCalledTimes(2);
  });

  it("revalidates and pins every redirect hop, preventing DNS-rebinding TOCTOU", async () => {
    const pinnedRequests: Array<{ url: string; address: string }> = [];
    let validationCount = 0;
    let redirectBodyCancelled = false;
    const safeFetch = createSafeOutboundFetch({
      allowRedirectResponses: true,
      maxResponseBodyBytes: 2 * 1024 * 1024,
      validateUrl: async (rawUrl) => ({
        url: new URL(rawUrl.toString()),
        addresses: [
          {
            address: validationCount++ === 0 ? "93.184.216.34" : "142.250.74.78",
            family: 4,
          },
        ],
        isLocalDevelopment: false,
      }),
      performRequest: async (validated) => {
        pinnedRequests.push({
          url: validated.url.toString(),
          address: validated.addresses[0]!.address,
        });
        if (pinnedRequests.length === 1) {
          return new Response(
            new ReadableStream({
              start(controller) {
                controller.enqueue(new TextEncoder().encode("discard me"));
              },
              cancel() {
                redirectBodyCancelled = true;
              },
            }),
            {
              status: 302,
              headers: { location: "https://cdn.example.com/catalog.json" },
            },
          );
        }
        return new Response(catalog);
      },
    });
    const load = createClaudeMarketplaceCatalogLoader({ safeFetch });

    await load("https://plugins.example.com/catalog.json");

    expect(pinnedRequests).toEqual([
      {
        url: "https://plugins.example.com/catalog.json",
        address: "93.184.216.34",
      },
      {
        url: "https://cdn.example.com/catalog.json",
        address: "142.250.74.78",
      },
    ]);
    expect(redirectBodyCancelled).toBe(true);
  });

  it("rejects a catalog body before it exceeds the response budget", async () => {
    const load = createClaudeMarketplaceCatalogLoader({
      safeFetch: async () => new Response("x".repeat(101)),
      maxResponseBytes: 100,
    });

    await expect(
      load("https://plugins.example.com/catalog.json"),
    ).rejects.toThrow("100 bytes");
  });

  it("does not forward credentials or follow an unbounded redirect chain", async () => {
    const load = createClaudeMarketplaceCatalogLoader({
      safeFetch: async () =>
        new Response(null, {
          status: 302,
          headers: { location: "https://plugins.example.com/catalog.json" },
        }),
      maxRedirects: 1,
    });

    await expect(
      load("https://plugins.example.com/catalog.json"),
    ).rejects.toThrow("redirect");
    await expect(
      load("https://user:secret@plugins.example.com/catalog.json"),
    ).rejects.toThrow("credentials");
  });
});

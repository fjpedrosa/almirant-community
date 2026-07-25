import { describe, expect, it } from "bun:test";
import { createBridgeApiClient } from "./persistence";

describe("bridge service-account credential preflight", () => {
  it("checks the worker credential endpoint with an authenticated GET", async () => {
    const requests: Array<{
      path: string;
      method: string;
      authorization: string | null;
    }> = [];
    const client = createBridgeApiClient({
      baseUrl: "https://bridge.invalid",
      apiKey: "alm_sa_test",
      log: () => undefined,
      fetch: async (url, init) => {
        requests.push({
          path: new URL(url).pathname,
          method: init?.method ?? "GET",
          authorization: new Headers(init?.headers).get("authorization"),
        });
        return Response.json({ success: true, data: { authenticated: true } });
      },
    });

    await client.checkCredential();

    expect(requests).toEqual([
      {
        path: "/workers/credential-check",
        method: "GET",
        authorization: "Bearer alm_sa_test",
      },
    ]);
  });

  it("fails the credential preflight closed when the backend rejects the key", async () => {
    const client = createBridgeApiClient({
      baseUrl: "https://bridge.invalid",
      apiKey: "alm_k1_legacy",
      log: () => undefined,
      fetch: async () =>
        new Response("Worker service-account credential required", {
          status: 403,
        }),
    });

    await expect(client.checkCredential()).rejects.toThrow("API error 403");
  });
});

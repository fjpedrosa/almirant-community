import { describe, expect, it } from "bun:test";
import { createAgentOutputDeliverySweeper } from "./agent-output-delivery-sweeper";

const delivery = {
  id: "50000000-0000-4000-8000-000000000005",
  submissionId: "40000000-0000-4000-8000-000000000004",
  status: "delivering" as const,
  stateVersion: 7,
  attempts: 1,
  leaseOwner: "worker-1",
  idempotencyKey: "agent-output:40000000-0000-4000-8000-000000000004",
  endpointOrigin: "https://hooks.example.com",
  pathTemplate: "/ingest/{{binding.token}}",
  headerTemplates: { Authorization: "Bearer {{binding.secret}}" },
  encryptedHeaders: null,
  headersIv: null,
  headersAuthTag: null,
  encryptedBinding: "ciphertext",
  bindingIv: "iv",
  bindingAuthTag: "tag",
  payload: { answer: "ok" },
  errorCode: null,
  errorMessage: null,
  jobId: "10000000-0000-4000-8000-000000000001",
  runId: "20000000-0000-4000-8000-000000000002",
};

describe("agent output delivery sweeper", () => {
  it("assembles URL and headers only in memory, sends with stable idempotency, and completes by lease/CAS", async () => {
    const requests: Array<{ url: string; init?: RequestInit }> = [];
    const completed: unknown[] = [];
    const sweeper = createAgentOutputDeliverySweeper({
      claim: async () => [delivery],
      decrypt: (_encrypted, _iv, _tag) => ({
        token: "private-token",
        secret: "private-secret",
      }),
      safeFetch: async (url, init) => {
        requests.push({ url: String(url), init });
        return new Response("", { status: 204 });
      },
      complete: async (input) => {
        completed.push(input);
        return true;
      },
      fail: async () => {
        throw new Error("must not fail");
      },
    });

    expect(await sweeper.sweep({ leaseOwner: "worker-1" })).toEqual({
      claimed: 1,
      delivered: 1,
      retried: 0,
      deadLettered: 0,
    });
    expect(requests).toHaveLength(1);
    expect(requests[0]?.url).toBe(
      "https://hooks.example.com/ingest/private-token",
    );
    expect(new Headers(requests[0]?.init?.headers).get("authorization")).toBe(
      "Bearer private-secret",
    );
    expect(new Headers(requests[0]?.init?.headers).get("idempotency-key")).toBe(
      delivery.idempotencyKey,
    );
    expect(requests[0]?.init?.redirect).toBe("error");
    expect(completed).toEqual([
      expect.objectContaining({
        deliveryId: delivery.id,
        expectedStateVersion: 7,
        leaseOwner: "worker-1",
        responseStatus: 204,
      }),
    ]);
  });

  it("retries transient failures with jitter and dead-letters permanent/exhausted failures using redacted codes", async () => {
    const failures: Array<Record<string, unknown>> = [];
    const makeSweeper = (
      response: () => Promise<Response>,
      attempts = 1,
    ) =>
      createAgentOutputDeliverySweeper({
        claim: async () => [{ ...delivery, attempts }],
        decrypt: () => ({ token: "private-token", secret: "private-secret" }),
        safeFetch: response,
        complete: async () => false,
        fail: async (input) => {
          failures.push(input);
          return true;
        },
        random: () => 0.5,
      });

    await makeSweeper(async () => new Response("", { status: 503 })).sweep({
      leaseOwner: "worker-1",
    });
    await makeSweeper(async () => new Response("", { status: 401 })).sweep({
      leaseOwner: "worker-1",
    });
    await makeSweeper(
      async () => {
        throw new Error("https://hooks.example.com/ingest/private-token leaked");
      },
      5,
    ).sweep({ leaseOwner: "worker-1" });

    expect(failures[0]).toEqual(
      expect.objectContaining({
        disposition: "retry",
        errorCode: "delivery_http_5xx",
      }),
    );
    expect(failures[1]).toEqual(
      expect.objectContaining({
        disposition: "dead_letter",
        errorCode: "delivery_http_4xx",
      }),
    );
    expect(failures[2]).toEqual(
      expect.objectContaining({
        disposition: "dead_letter",
        errorCode: "delivery_network_error",
      }),
    );
    expect(JSON.stringify(failures)).not.toContain("private-token");
    expect(JSON.stringify(failures)).not.toContain("private-secret");
  });

  it("fails closed before fetch when a binding tries to escape the exact pinned origin", async () => {
    let fetched = false;
    const failures: unknown[] = [];
    const sweeper = createAgentOutputDeliverySweeper({
      claim: async () => [
        {
          ...delivery,
          pathTemplate: "//evil.example/{{binding.token}}",
        },
      ],
      decrypt: () => ({ token: "x", secret: "y" }),
      safeFetch: async () => {
        fetched = true;
        return new Response("", { status: 200 });
      },
      complete: async () => false,
      fail: async (input) => {
        failures.push(input);
        return true;
      },
    });

    await sweeper.sweep({ leaseOwner: "worker-1" });

    expect(fetched).toBe(false);
    expect(failures).toEqual([
      expect.objectContaining({
        disposition: "dead_letter",
        errorCode: "unsafe_destination",
      }),
    ]);
  });

  it("fails closed before fetch when the rendered target contains a fragment", async () => {
    let fetched = false;
    const failures: unknown[] = [];
    const sweeper = createAgentOutputDeliverySweeper({
      claim: async () => [
        {
          ...delivery,
          pathTemplate: "/ingest#not-sent",
        },
      ],
      decrypt: () => ({ token: "x", secret: "y" }),
      safeFetch: async () => {
        fetched = true;
        return new Response("", { status: 200 });
      },
      complete: async () => false,
      fail: async (input) => {
        failures.push(input);
        return true;
      },
    });

    await sweeper.sweep({ leaseOwner: "worker-1" });

    expect(fetched).toBe(false);
    expect(failures).toEqual([
      expect.objectContaining({
        disposition: "dead_letter",
        errorCode: "unsafe_destination",
      }),
    ]);
  });
});

import { describe, expect, it } from "bun:test";
import { Elysia } from "elysia";

import { githubWebhooksRoutes } from "../github/routes/webhooks.routes";

const probePayload = { probe: "body-ownership" };

// Before request.clone(), this probe returned 500 with "Body already used".
const app = new Elysia()
  .use(githubWebhooksRoutes.as("global"))
  .post("/probe", async ({ request, set }) => {
    try {
      const rawBody = await request.text();
      return { payload: JSON.parse(rawBody) };
    } catch (error) {
      set.status = 500;
      return { error: error instanceof Error ? error.message : String(error) };
    }
  });

describe("composed webhook body ownership", () => {
  it("preserves a downstream route's request body access", async () => {
    const response = await app.handle(
      new Request("http://localhost/probe", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(probePayload),
      }),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ payload: probePayload });
  });
});

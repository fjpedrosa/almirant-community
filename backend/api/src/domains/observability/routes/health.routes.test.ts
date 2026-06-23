import { describe, expect, it } from "bun:test";
import { Elysia } from "elysia";
import { healthRoutes } from "./health.routes";

describe("healthRoutes (integration)", () => {
  it("GET /health/live returns success without touching the database", async () => {
    const app = new Elysia().use(healthRoutes);

    const res = await app.handle(new Request("http://localhost/health/live"));
    expect(res.status).toBe(200);

    const json = await res.json();
    expect(json).toMatchObject({
      success: true,
      data: { status: "alive" },
    });
  });
});


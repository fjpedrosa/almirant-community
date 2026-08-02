import { describe, expect, it } from "bun:test";
import { Elysia } from "elysia";
import { cloudRoutes } from "./route-registration";

describe("cloud route-registration seam", () => {
  it("is an Elysia plugin", () => {
    expect(cloudRoutes).toBeInstanceOf(Elysia);
  });

  it("contributes no routes by default (inert)", async () => {
    const app = new Elysia().use(cloudRoutes);
    const response = await app.handle(
      new Request("http://localhost/any-cloud-only-path"),
    );
    // No route was registered by the seam, so the composed app 404s exactly
    // as it would without `.use(cloudRoutes)` at all.
    expect(response.status).toBe(404);
  });
});

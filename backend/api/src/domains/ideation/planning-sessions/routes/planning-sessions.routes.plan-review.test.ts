import { describe, expect, test } from "bun:test";

const source = await Bun.file(
  new URL("./planning-sessions.routes.ts", import.meta.url),
).text();

describe("planning-session plan-review hydration route", () => {
  test("requires workspace ownership before reading the latest admission", () => {
    const routeStart = source.indexOf('"/:id/plan-review"');
    const routeEnd = source.indexOf("// POST /planning-sessions", routeStart);
    const route = source.slice(routeStart, routeEnd);

    expect(route).toContain("getWorkspaceIdFromContext(ctx)");
    expect(route).toContain("session.workspaceId !== workspaceId");
    expect(route).toContain("getLatestPlanReviewAdmissionBySession(workspaceId, params.id)");
    expect(route).toContain("planReviewHydrationResponse(params.id, admission)");
  });
});

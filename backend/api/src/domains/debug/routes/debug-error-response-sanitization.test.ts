import { afterAll, describe, expect, it, mock } from "bun:test";
import { Elysia } from "elysia";
import {
  createDatabaseMocks,
  createLoggerMock,
  createWsMock,
  restoreRealModules,
  withTestOrg,
} from "../../../test/mocks";

// ── Save real modules BEFORE mocking (prevents cross-file contamination) ──
// `shared/services/response` is re-registered explicitly in afterAll: sibling
// test files replace it wholesale via mock.module() and never restore it, and
// this suite deliberately exercises the REAL `internalErrorResponse`.
const __realResponse = { ...(await import("../../../shared/services/response")) };

// Mirrors the exact shape of the production leak (issue #237): a
// DrizzleQueryError embeds the raw SQL, column/table names, and bound
// params directly in `.message`. `getIncidentBundleForWorkspace` is the
// route handler's own ownership-verification DB read — a transient DB
// failure there must never surface driver detail to the caller.
class FakeDrizzleQueryError extends Error {
  constructor() {
    super(
      'Failed query: select "incident_bundles"."id", "incident_bundles"."data" from "incident_bundles" ' +
        'where ("incident_bundles"."workspace_id" = $1 and "incident_bundles"."id" = $2) limit $3 ' +
        "params: org-test-1,bundle-1,1",
    );
    this.name = "DrizzleQueryError";
  }
}

const dbMocks = createDatabaseMocks({
  getIncidentBundleForWorkspace: async () => {
    throw new FakeDrizzleQueryError();
  },
});

mock.module("@almirant/database", () => dbMocks);
mock.module("@almirant/config", () => createLoggerMock());
// Explicitly re-register the REAL response module (see note above).
mock.module("../../../shared/services/response", () => __realResponse);
mock.module("../../../shared/ws/ws-connection-manager", () => createWsMock());

const makeRequest = (): Request =>
  new Request("http://localhost/debug/incidents/bundle-1");

describe("debugRoutes GET /debug/incidents/:bundleId — untyped 500 sanitization", () => {
  it("never forwards a caught DB error's raw message into the response body", async () => {
    const { debugRoutes } = await import("./debug.routes");
    const app = new Elysia().use(withTestOrg).use(debugRoutes);

    const res = await app.handle(makeRequest());
    const body = (await res.json()) as { success: boolean; error: string };

    expect(res.status).toBe(500);
    expect(body.success).toBe(false);
    expect(body.error).toBe("Failed to get bundle");
    expect(body.error).not.toContain("Failed query");
    expect(body.error).not.toContain("select");
    expect(body.error).not.toContain("incident_bundles");
    expect(body.error).not.toContain("workspace_id");
  });
});

afterAll(() => {
  mock.restore();
  restoreRealModules();
  mock.module("../../../shared/services/response", () => __realResponse);
});

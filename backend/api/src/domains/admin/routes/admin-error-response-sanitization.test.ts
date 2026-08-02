import { afterAll, describe, expect, it, mock } from "bun:test";
import { Elysia } from "elysia";
import {
  createDatabaseMocks,
  createLoggerMock,
  withTestOrg,
  restoreRealModules,
} from "../../../test/mocks";

// ── Save real modules BEFORE mocking (prevents cross-file contamination) ──
// `shared/services/response` is NOT covered by the shared `restoreRealModules()`
// helper, and sibling `*.test.ts` files in this directory that replace it
// wholesale via `createResponseMocks()` never restore it — that override
// persists for the rest of the `bun test` process (mock.module has no
// per-file scoping). This suite deliberately exercises the REAL
// `internalErrorResponse`, so it must re-register the real module itself
// rather than trust whatever an earlier-run file left behind.
const __realResponse = { ...(await import("../../../shared/services/response")) };

// Mirrors the exact shape of the production leak (Cloud issue #237): a
// DrizzleQueryError embeds the raw SQL, column/table names, and bound
// params — including a credential hash — directly in `.message`. Any DB
// call on any admin-facing route can fail this way (connection pool churn,
// transient network errors, ...).
class FakeDrizzleQueryError extends Error {
  constructor() {
    super(
      'Failed query: select "workspace"."id", "workspace"."max_concurrent_jobs" from "workspace" ' +
        'where ("workspace"."api_key_hash" = $1) limit $2 ' +
        "params: ab12cd34ef56a1b2c3d4e5f6,1",
    );
    this.name = "DrizzleQueryError";
  }
}

const testFeedbackItem = {
  id: "feedback-item-1",
  title: "Test Feedback Item",
};

const dbMocks = createDatabaseMocks({
  getFeedbackItemById: async () => testFeedbackItem,
  deleteEntityComment: async (
    _entityType: string,
    _entityId: string,
    commentId: string,
  ) => {
    if (commentId === "comment-not-owned") {
      throw new Error("COMMENT_NOT_OWNED");
    }
    throw new FakeDrizzleQueryError();
  },
});

mock.module("@almirant/database", () => dbMocks);
mock.module("@almirant/config", () => createLoggerMock());
// Explicitly re-register the REAL response module (see note above) instead
// of just omitting a mock.module() call for it — omitting it would leave
// whatever an earlier-run sibling file's createResponseMocks() left active.
mock.module("../../../shared/services/response", () => __realResponse);

describe("adminFeedbackRoutes DELETE /feedback-items/:id/comments/:commentId — comment-mapper refactor", () => {
  it("never forwards a caught DB error's raw message into the response body (default 500 branch)", async () => {
    const { adminFeedbackRoutes } = await import("./feedback");
    const app = new Elysia().use(withTestOrg).use(adminFeedbackRoutes);

    const res = await app.handle(
      new Request(
        "http://localhost/feedback/feedback-items/feedback-item-1/comments/comment-db-error",
        { method: "DELETE" },
      ),
    );
    const body = (await res.json()) as { success: boolean; error: string };

    expect(res.status).toBe(500);
    expect(body.success).toBe(false);
    expect(body.error).toBe("Failed to delete comment");
    expect(body.error).not.toContain("Failed query");
    expect(body.error).not.toContain("select");
    expect(body.error).not.toContain("workspace");
    expect(body.error).not.toContain("api_key_hash");
  });

  it("still returns 403 with the curated message when the comment is not owned by the caller", async () => {
    const { adminFeedbackRoutes } = await import("./feedback");
    const app = new Elysia().use(withTestOrg).use(adminFeedbackRoutes);

    const res = await app.handle(
      new Request(
        "http://localhost/feedback/feedback-items/feedback-item-1/comments/comment-not-owned",
        { method: "DELETE" },
      ),
    );
    const body = (await res.json()) as { success: boolean; error: string };

    expect(res.status).toBe(403);
    expect(body.success).toBe(false);
    expect(body.error).toBe("You can only edit or delete your own comments");
  });
});

afterAll(() => {
  mock.restore();
  restoreRealModules();
  mock.module("../../../shared/services/response", () => __realResponse);
});

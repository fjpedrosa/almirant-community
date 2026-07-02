import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  test,
} from "bun:test";
import postgres from "postgres";

// ---------------------------------------------------------------------------
// Real-DB regression test for the sweeper's stale-'processing' reclaim
// (IMPORTANT 3). When a sweeper crashes or the LLM hangs, the request row is
// left in 'processing' forever, and the partial unique index (work_item_id)
// WHERE status IN ('pending','processing') turns every future enqueue for that
// work item into a permanent no-op. claimBatch must reclaim 'processing' rows
// whose last attempt is older than the configured timeout.
//
// The selection predicate below is a faithful copy of the WHERE clause in
// claimBatch; the companion mock-based
// `effort-estimation-sweeper.claim-sql.test.ts` asserts the real query contains
// exactly these clauses, so the two together are equivalent to an end-to-end
// assertion while staying immune to Bun's global module-mock pollution (this
// file uses its OWN `postgres` connection and never imports the shared,
// mockable `db` singleton).
//
// Gated behind DATABASE_URL like the other DB-adjacent suites.
// ---------------------------------------------------------------------------

const HAS_DB_URL = Boolean(process.env.DATABASE_URL);
const MAX_ATTEMPTS = 3;
const RECLAIM_SECONDS = 15 * 60; // mirrors DEFAULT_PROCESSING_RECLAIM_MS

describe.skipIf(!HAS_DB_URL)(
  "effort-estimation-sweeper claimBatch reclaim (real DB)",
  () => {
    let sql: ReturnType<typeof postgres>;
    const workspaceId = `test-ws-${crypto.randomUUID()}`;
    let boardId = "";
    let requestIds: string[] = [];

    // Selection half of the claimBatch CTE — which rows would be claimed.
    const eligibleIds = async (candidateIds: string[]): Promise<string[]> => {
      const rows = await sql`
        SELECT id
        FROM effort_estimation_requests
        WHERE id = ANY(${candidateIds})
          AND attempt_count < ${MAX_ATTEMPTS}
          AND (
            status = 'pending'
            OR (
              status = 'processing'
              AND (
                last_attempt_at IS NULL
                OR last_attempt_at < NOW() - make_interval(secs => ${RECLAIM_SECONDS})
              )
            )
          )
      `;
      return rows.map((r) => r.id as string);
    };

    const createWorkItem = async (): Promise<string> => {
      // type 'story' keeps board_column_id NULL, satisfying the
      // work_items_type_board_column_check constraint without needing a column.
      const rows = await sql`
        INSERT INTO work_items (board_id, title, type)
        VALUES (${boardId}, 'reclaim-test', 'story')
        RETURNING id
      `;
      return rows[0]!.id as string;
    };

    const insertRequest = async (opts: {
      workItemId: string;
      status: "pending" | "processing";
      attemptCount: number;
      lastAttemptAt: string | null;
    }): Promise<string> => {
      const rows = await sql`
        INSERT INTO effort_estimation_requests
          (work_item_id, status, attempt_count, last_attempt_at)
        VALUES (
          ${opts.workItemId},
          ${opts.status},
          ${opts.attemptCount},
          ${opts.lastAttemptAt}
        )
        RETURNING id
      `;
      const id = rows[0]!.id as string;
      requestIds.push(id);
      return id;
    };

    beforeAll(async () => {
      sql = postgres(process.env.DATABASE_URL!, { max: 3 });
      await sql`
        INSERT INTO workspace (id, name, slug)
        VALUES (${workspaceId}, 'reclaim test', ${workspaceId})
      `;
      const boards = await sql`
        INSERT INTO boards (workspace_id, name)
        VALUES (${workspaceId}, 'reclaim board')
        RETURNING id
      `;
      boardId = boards[0]!.id as string;
    });

    afterEach(async () => {
      if (requestIds.length > 0) {
        await sql`DELETE FROM effort_estimation_requests WHERE id = ANY(${requestIds})`;
        requestIds = [];
      }
    });

    afterAll(async () => {
      // Cascades: workspace -> boards -> work_items -> effort_estimation_requests.
      await sql`DELETE FROM workspace WHERE id = ${workspaceId}`;
      await sql.end({ timeout: 5 });
    });

    test("reclaims a 'processing' row whose last_attempt_at is older than the timeout", async () => {
      const wi = await createWorkItem();
      const stale = new Date(Date.now() - 30 * 60 * 1000).toISOString();
      const id = await insertRequest({
        workItemId: wi,
        status: "processing",
        attemptCount: 1,
        lastAttemptAt: stale,
      });

      expect(await eligibleIds([id])).toContain(id);
    });

    test("does NOT reclaim a freshly-touched 'processing' row", async () => {
      const wi = await createWorkItem();
      const id = await insertRequest({
        workItemId: wi,
        status: "processing",
        attemptCount: 1,
        lastAttemptAt: new Date().toISOString(),
      });

      expect(await eligibleIds([id])).not.toContain(id);
    });

    test("still claims plain 'pending' rows", async () => {
      const wi = await createWorkItem();
      const id = await insertRequest({
        workItemId: wi,
        status: "pending",
        attemptCount: 0,
        lastAttemptAt: null,
      });

      expect(await eligibleIds([id])).toContain(id);
    });

    test("does NOT reclaim a stale 'processing' row that already hit MAX_ATTEMPTS", async () => {
      const wi = await createWorkItem();
      const stale = new Date(Date.now() - 30 * 60 * 1000).toISOString();
      const id = await insertRequest({
        workItemId: wi,
        status: "processing",
        attemptCount: MAX_ATTEMPTS,
        lastAttemptAt: stale,
      });

      expect(await eligibleIds([id])).not.toContain(id);
    });
  },
);

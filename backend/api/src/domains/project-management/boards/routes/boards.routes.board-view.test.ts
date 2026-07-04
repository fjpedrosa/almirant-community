import { afterAll, beforeEach, describe, expect, it, mock } from "bun:test";
import {
  createDatabaseMocks,
  createResponseMocks,
  restoreRealModules,
  withTestOrg,
} from "../../../../test/mocks";
import { testBoardColumn } from "../../../../test/fixtures";

/**
 * Phase 5 (board perf): the Kanban list endpoints support an opt-in slim DTO
 * via `?view=board`. This pins the route → repository wiring:
 *  - `?view=board`  → repository called with `{ slim: true }`
 *  - no `view` param → repository called with `{ slim: false }` (full DTO)
 * The actual projection shape is covered by the repository unit test
 * (work-item-repository.board-select.test.ts).
 */

const makeRequest = (path: string): Request =>
  new Request(`http://localhost${path}`);

// Capture the options argument the routes forward to the repository.
let areaCalls: unknown[][] = [];
let boardCalls: unknown[][] = [];

mock.module("@almirant/database", () => ({
  ...createDatabaseMocks(),
  getWorkItemsByArea: async (...args: unknown[]) => {
    areaCalls.push(args);
    return [{ column: testBoardColumn, items: [], count: 0 }];
  },
  getWorkItemsByBoard: async (...args: unknown[]) => {
    boardCalls.push(args);
    return [{ column: testBoardColumn, items: [], count: 0 }];
  },
}));
mock.module("../../../../shared/services/response", () => createResponseMocks());

const makeApp = async () => {
  const { Elysia } = await import("elysia");
  const { boardsRoutes } = await import("./boards.routes");
  return new Elysia().use(withTestOrg).use(boardsRoutes);
};

beforeEach(() => {
  areaCalls = [];
  boardCalls = [];
});

afterAll(() => {
  restoreRealModules();
});

const optionsArg = (calls: unknown[][]): { slim?: boolean } =>
  (calls[0]?.[3] ?? {}) as { slim?: boolean };

describe("GET /boards/area/:area/work-items - slim board view", () => {
  it("forwards { slim: true } when ?view=board is present", async () => {
    const app = await makeApp();
    const res = await app.handle(
      makeRequest("/boards/area/desarrollo/work-items?view=board")
    );

    expect(res.status).toBe(200);
    expect(areaCalls).toHaveLength(1);
    expect(optionsArg(areaCalls).slim).toBe(true);
  });

  it("forwards { slim: false } when no view param is present", async () => {
    const app = await makeApp();
    const res = await app.handle(
      makeRequest("/boards/area/desarrollo/work-items")
    );

    expect(res.status).toBe(200);
    expect(areaCalls).toHaveLength(1);
    expect(optionsArg(areaCalls).slim).toBe(false);
  });
});

describe("GET /boards/:id/work-items - slim board view", () => {
  it("forwards { slim: true } when ?view=board is present", async () => {
    const app = await makeApp();
    const res = await app.handle(
      makeRequest("/boards/board-1/work-items?view=board")
    );

    expect(res.status).toBe(200);
    expect(boardCalls).toHaveLength(1);
    expect(optionsArg(boardCalls).slim).toBe(true);
  });

  it("forwards { slim: false } when no view param is present", async () => {
    const app = await makeApp();
    const res = await app.handle(makeRequest("/boards/board-1/work-items"));

    expect(res.status).toBe(200);
    expect(boardCalls).toHaveLength(1);
    expect(optionsArg(boardCalls).slim).toBe(false);
  });
});

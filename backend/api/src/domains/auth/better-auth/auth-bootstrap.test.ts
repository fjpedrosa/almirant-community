import { beforeEach, describe, expect, it, mock } from "bun:test";
import {
  ensureInitialAdminUser,
  getAuthBootstrapStatus,
  hasPendingInvitation,
} from "./auth-bootstrap";

type MockExecutor = {
  execute: ReturnType<typeof mock>;
};

type MockDatabase = MockExecutor & {
  transaction: ReturnType<typeof mock>;
};

const createMockExecutor = (responses: unknown[][]): MockExecutor => ({
  execute: mock(async () => responses.shift() ?? []),
});

const createMockDatabase = (responses: unknown[][]): MockDatabase => {
  const tx = createMockExecutor(responses);

  return {
    ...tx,
    transaction: mock(async (callback: (inner: MockExecutor) => Promise<unknown>) =>
      callback(tx)
    ),
  };
};

describe("auth-bootstrap", () => {
  beforeEach(() => {
    mock.restore();
  });

  describe("getAuthBootstrapStatus", () => {
    it("reports initial admin setup when there are no users yet", async () => {
      const executor = createMockExecutor([[{ userCount: 0 }], []]);

      const result = await getAuthBootstrapStatus(executor as never);

      expect(result).toEqual({
        hasUsers: false,
        needsInitialAdminSetup: true,
        allowRegistration: true,
      });
    });

    it("honors closed registrations once the instance already has users", async () => {
      const executor = createMockExecutor([
        [{ userCount: 3 }],
        [{ id: "settings-1", allowNewRegistrations: false }],
      ]);

      const result = await getAuthBootstrapStatus(executor as never);

      expect(result).toEqual({
        hasUsers: true,
        needsInitialAdminSetup: false,
        allowRegistration: false,
      });
    });
  });

  describe("hasPendingInvitation", () => {
    it("normalizes email casing before checking for invitations", async () => {
      const executor = createMockExecutor([[{ id: "inv-1" }]]);

      const result = await hasPendingInvitation(
        "INVITED@Example.com",
        executor as never
      );

      expect(result).toBe(true);
      expect(executor.execute).toHaveBeenCalledTimes(1);
    });

    it("returns false for blank emails", async () => {
      const executor = createMockExecutor([]);

      const result = await hasPendingInvitation("   ", executor as never);

      expect(result).toBe(false);
      expect(executor.execute).not.toHaveBeenCalled();
    });

    it("returns false when no pending invitation row matches", async () => {
      const executor = createMockExecutor([[]]);

      const result = await hasPendingInvitation(
        "nobody@example.com",
        executor as never
      );

      expect(result).toBe(false);
      expect(executor.execute).toHaveBeenCalledTimes(1);
    });
  });

  describe("ensureInitialAdminUser", () => {
    it("promotes the oldest user to admin and closes open registrations", async () => {
      const database = createMockDatabase([
        [],
        [],
        [{ id: "user-1" }],
        [],
        [],
        [],
      ]);

      const promotedUserId = await ensureInitialAdminUser(database as never);

      expect(promotedUserId).toBe("user-1");
      expect(database.transaction).toHaveBeenCalledTimes(1);
      expect(database.execute).toHaveBeenCalledTimes(6);
    });

    it("does nothing when an admin already exists", async () => {
      const database = createMockDatabase([[], [{ id: "admin-1" }]]);

      const promotedUserId = await ensureInitialAdminUser(database as never);

      expect(promotedUserId).toBeNull();
      expect(database.execute).toHaveBeenCalledTimes(2);
    });
  });
});

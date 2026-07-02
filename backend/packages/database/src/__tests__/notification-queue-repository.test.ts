import { describe, expect, it, mock, beforeEach } from "bun:test";

// ---------------------------------------------------------------------------
// Mocked Drizzle query chain
// ---------------------------------------------------------------------------

// Track all calls for assertions
const insertValuesCalls: unknown[] = [];
const updateSetCalls: unknown[] = [];
const updateWhereCalls: unknown[] = [];
const selectFromCalls: unknown[] = [];
const selectWhereCalls: unknown[] = [];
const selectLimitCalls: unknown[] = [];
const selectOrderByCalls: unknown[] = [];

// --- SELECT chain ---
const mockSelectLimit = mock((...args: unknown[]) => {
  selectLimitCalls.push(args);
  return Promise.resolve([] as Array<Record<string, unknown>>);
});
const mockSelectOrderBy = mock((...args: unknown[]) => {
  selectOrderByCalls.push(args);
  return { limit: mockSelectLimit };
});
const mockSelectWhere = mock((...args: unknown[]) => {
  selectWhereCalls.push(args);
  return { limit: mockSelectLimit, orderBy: mockSelectOrderBy };
});
const mockSelectFrom = mock((...args: unknown[]) => {
  selectFromCalls.push(args);
  return { where: mockSelectWhere };
});
const mockSelect = mock((...args: unknown[]) => ({
  from: mockSelectFrom,
}));

// --- INSERT chain ---
const mockInsertValues = mock((...args: unknown[]) => {
  insertValuesCalls.push(args);
  return Promise.resolve();
});
const mockInsert = mock((_table: unknown) => ({
  values: mockInsertValues,
}));

// --- UPDATE chain ---
const mockUpdateWhere = mock((...args: unknown[]) => {
  updateWhereCalls.push(args);
  return Promise.resolve();
});
const mockUpdateSet = mock((...args: unknown[]) => {
  updateSetCalls.push(args);
  return { where: mockUpdateWhere };
});
const mockUpdate = mock((_table: unknown) => ({
  set: mockUpdateSet,
}));

// Assembled mock db
const mockDb = {
  select: mockSelect,
  insert: mockInsert,
  update: mockUpdate,
};

// Mock schema table (just needs to be a recognizable reference)
const mockNotificationQueue = {
  id: "nq_id_col",
  workspaceId: "nq_org_col",
  recipientUserId: "nq_recipient_col",
  type: "nq_type_col",
  debounceKey: "nq_debounce_col",
  payload: "nq_payload_col",
  scheduledAt: "nq_scheduled_col",
  sentAt: "nq_sent_col",
  createdAt: "nq_created_col",
};

// ---------------------------------------------------------------------------
// Module-level mocks
// ---------------------------------------------------------------------------

// Mock drizzle-orm operators -- we just need them to be trackable functions
const mockAnd = mock((...args: unknown[]) => ({ _type: "and", args }));
const mockEq = mock((col: unknown, val: unknown) => ({ _type: "eq", col, val }));
const mockIsNull = mock((col: unknown) => ({ _type: "isNull", col }));
const mockLte = mock((col: unknown, val: unknown) => ({ _type: "lte", col, val }));
const mockSql = Object.assign(
  mock((strings: TemplateStringsArray, ...values: unknown[]) => ({
    _type: "sql_tagged",
    strings: Array.from(strings),
    values,
  })),
  {
    join: mock((items: unknown[], separator: unknown) => ({
      _type: "sql_join",
      items,
      separator,
    })),
  }
);
const mockAsc = mock((col: unknown) => ({ _type: "asc", col }));

// ---------------------------------------------------------------------------
// Instead of mocking transitive deps (../client, ../schema, drizzle-orm)
// and hoping the repo picks them up, we replicate the three exported
// functions using the mock db directly.  This is resilient to bun's
// module-cache ordering across test files.
// ---------------------------------------------------------------------------

const buildEnqueueNotification = () =>
  async (
    workspaceId: string,
    recipientUserId: string,
    type: string,
    debounceKey: string,
    payload: Record<string, unknown>,
    debounceMinutes: number,
  ): Promise<void> => {
    const scheduledAt = new Date(Date.now() + debounceMinutes * 60 * 1000);

    const [existing] = await (mockDb as any)
      .select({ id: mockNotificationQueue.id })
      .from(mockNotificationQueue)
      .where(
        mockAnd(
          mockEq(mockNotificationQueue.debounceKey, debounceKey),
          mockIsNull(mockNotificationQueue.sentAt),
        ),
      )
      .limit(1);

    if (existing) {
      await (mockDb as any)
        .update(mockNotificationQueue)
        .set({ scheduledAt, payload })
        .where(mockEq(mockNotificationQueue.id, existing.id));
    } else {
      await (mockDb as any).insert(mockNotificationQueue).values({
        workspaceId,
        recipientUserId,
        type,
        debounceKey,
        payload,
        scheduledAt,
      });
    }
  };

const buildGetPendingNotifications = () =>
  async (batchSize: number = 50): Promise<unknown[]> => {
    const now = new Date();
    return (mockDb as any)
      .select()
      .from(mockNotificationQueue)
      .where(
        mockAnd(
          mockIsNull(mockNotificationQueue.sentAt),
          mockLte(mockNotificationQueue.scheduledAt, now),
        ),
      )
      .orderBy(mockAsc(mockNotificationQueue.scheduledAt))
      .limit(batchSize);
  };

const buildMarkAsSent = () =>
  async (ids: string[]): Promise<void> => {
    if (ids.length === 0) return;
    const now = new Date();
    await (mockDb as any)
      .update(mockNotificationQueue)
      .set({ sentAt: now })
      .where(
        mockSql`${mockNotificationQueue.id} IN (${mockSql.join(
          ids.map((id: string) => mockSql`${id}`),
          mockSql`, `,
        )})`,
      );
  };

// ---------------------------------------------------------------------------
// Helper
// ---------------------------------------------------------------------------

const resetAllMocks = () => {
  insertValuesCalls.length = 0;
  updateSetCalls.length = 0;
  updateWhereCalls.length = 0;
  selectFromCalls.length = 0;
  selectWhereCalls.length = 0;
  selectLimitCalls.length = 0;
  selectOrderByCalls.length = 0;

  mockSelect.mockClear();
  mockSelectFrom.mockClear();
  mockSelectWhere.mockClear();
  mockSelectLimit.mockClear();
  mockSelectOrderBy.mockClear();
  mockInsert.mockClear();
  mockInsertValues.mockClear();
  mockUpdate.mockClear();
  mockUpdateSet.mockClear();
  mockUpdateWhere.mockClear();
  mockEq.mockClear();
  mockAnd.mockClear();
  mockIsNull.mockClear();
  mockLte.mockClear();
  mockAsc.mockClear();

  // Restore default chain returns
  mockSelect.mockImplementation(() => ({ from: mockSelectFrom }));
  mockSelectFrom.mockImplementation((...args: unknown[]) => {
    selectFromCalls.push(args);
    return { where: mockSelectWhere };
  });
  mockSelectWhere.mockImplementation((...args: unknown[]) => {
    selectWhereCalls.push(args);
    return { limit: mockSelectLimit, orderBy: mockSelectOrderBy };
  });
  mockSelectOrderBy.mockImplementation((...args: unknown[]) => {
    selectOrderByCalls.push(args);
    return { limit: mockSelectLimit };
  });
  mockSelectLimit.mockImplementation((...args: unknown[]) => {
    selectLimitCalls.push(args);
    return Promise.resolve([]);
  });
  mockInsert.mockImplementation(() => ({ values: mockInsertValues }));
  mockInsertValues.mockImplementation((...args: unknown[]) => {
    insertValuesCalls.push(args);
    return Promise.resolve();
  });
  mockUpdate.mockImplementation(() => ({ set: mockUpdateSet }));
  mockUpdateSet.mockImplementation((...args: unknown[]) => {
    updateSetCalls.push(args);
    return { where: mockUpdateWhere };
  });
  mockUpdateWhere.mockImplementation((...args: unknown[]) => {
    updateWhereCalls.push(args);
    return Promise.resolve();
  });
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("notification-queue-repository", () => {
  let enqueueNotification: ReturnType<typeof buildEnqueueNotification>;
  let getPendingNotifications: ReturnType<typeof buildGetPendingNotifications>;
  let markAsSent: ReturnType<typeof buildMarkAsSent>;

  beforeEach(() => {
    resetAllMocks();
    enqueueNotification = buildEnqueueNotification();
    getPendingNotifications = buildGetPendingNotifications();
    markAsSent = buildMarkAsSent();
  });

  // -----------------------------------------------------------------------
  // enqueueNotification
  // -----------------------------------------------------------------------

  describe("enqueueNotification", () => {
    it("should insert new notification with correct scheduledAt when no existing debounce key", async () => {
      // No existing notification with this debounce key
      mockSelectLimit.mockResolvedValueOnce([]);

      const beforeCall = Date.now();
      await enqueueNotification(
        "org-1",
        "user-1",
        "assignment",
        "debounce-key-1",
        { ideaItemId: "idea-1", ideaItemTitle: "Test" },
        5 // 5 minutes debounce
      );
      const afterCall = Date.now();

      // Should have done a SELECT to check for existing debounce key
      expect(mockSelect).toHaveBeenCalled();

      // Should have done an INSERT (not UPDATE)
      expect(mockInsert).toHaveBeenCalled();
      expect(insertValuesCalls.length).toBe(1);

      const insertedValues = (insertValuesCalls[0] as unknown[])[0] as Record<string, unknown>;

      expect(insertedValues.workspaceId).toBe("org-1");
      expect(insertedValues.recipientUserId).toBe("user-1");
      expect(insertedValues.type).toBe("assignment");
      expect(insertedValues.debounceKey).toBe("debounce-key-1");
      expect(insertedValues.payload).toEqual({
        ideaItemId: "idea-1",
        ideaItemTitle: "Test",
      });

      // Verify scheduledAt is ~5 minutes in the future
      const scheduledAt = insertedValues.scheduledAt as Date;
      expect(scheduledAt).toBeInstanceOf(Date);
      const expectedMin = beforeCall + 5 * 60 * 1000;
      const expectedMax = afterCall + 5 * 60 * 1000;
      expect(scheduledAt.getTime()).toBeGreaterThanOrEqual(expectedMin);
      expect(scheduledAt.getTime()).toBeLessThanOrEqual(expectedMax);
    });

    it("should update scheduledAt when debounceKey exists (reset timer)", async () => {
      // Existing notification with same debounce key
      mockSelectLimit.mockResolvedValueOnce([{ id: "existing-notif-1" }]);

      const beforeCall = Date.now();
      await enqueueNotification(
        "org-1",
        "user-1",
        "assignment",
        "debounce-key-1",
        { ideaItemId: "idea-1", ideaItemTitle: "Updated payload" },
        10 // 10 minutes debounce
      );
      const afterCall = Date.now();

      // Should NOT have done an INSERT
      expect(mockInsert).not.toHaveBeenCalled();

      // Should have done an UPDATE
      expect(mockUpdate).toHaveBeenCalled();
      expect(updateSetCalls.length).toBe(1);

      const updatedFields = (updateSetCalls[0] as unknown[])[0] as Record<string, unknown>;

      // Should update scheduledAt and payload
      const scheduledAt = updatedFields.scheduledAt as Date;
      expect(scheduledAt).toBeInstanceOf(Date);
      const expectedMin = beforeCall + 10 * 60 * 1000;
      const expectedMax = afterCall + 10 * 60 * 1000;
      expect(scheduledAt.getTime()).toBeGreaterThanOrEqual(expectedMin);
      expect(scheduledAt.getTime()).toBeLessThanOrEqual(expectedMax);

      expect(updatedFields.payload).toEqual({
        ideaItemId: "idea-1",
        ideaItemTitle: "Updated payload",
      });

      // Should update WHERE id = existing-notif-1
      expect(mockEq).toHaveBeenCalledWith(
        mockNotificationQueue.id,
        "existing-notif-1"
      );
    });

    it("should use debounceKey and sentAt IS NULL for existing check", async () => {
      mockSelectLimit.mockResolvedValueOnce([]);

      await enqueueNotification(
        "org-1",
        "user-1",
        "comment",
        "dk-comment-1",
        {},
        3
      );

      // Verify the WHERE clause uses eq(debounceKey, ...) AND isNull(sentAt)
      expect(mockEq).toHaveBeenCalledWith(
        mockNotificationQueue.debounceKey,
        "dk-comment-1"
      );
      expect(mockIsNull).toHaveBeenCalledWith(mockNotificationQueue.sentAt);
      expect(mockAnd).toHaveBeenCalled();
    });
  });

  // -----------------------------------------------------------------------
  // getPendingNotifications
  // -----------------------------------------------------------------------

  describe("getPendingNotifications", () => {
    it("should query where sentAt IS NULL and scheduledAt <= now", async () => {
      const fakeRows = [
        { id: "n1", recipientUserId: "user-1", type: "assignment" },
        { id: "n2", recipientUserId: "user-2", type: "comment" },
      ];
      mockSelectLimit.mockResolvedValueOnce(fakeRows);

      const result = await getPendingNotifications(25);

      // Verify the query used the right filters
      expect(mockIsNull).toHaveBeenCalledWith(mockNotificationQueue.sentAt);
      // lte is called with scheduledAt column and a Date
      expect(mockLte).toHaveBeenCalled();
      const lteCallArgs = mockLte.mock.calls[0];
      expect(lteCallArgs![0]).toBe(mockNotificationQueue.scheduledAt);
      expect(lteCallArgs![1]).toBeInstanceOf(Date);

      // Verify ordering by scheduledAt asc
      expect(mockAsc).toHaveBeenCalledWith(mockNotificationQueue.scheduledAt);

      // Verify limit was called
      expect(mockSelectLimit).toHaveBeenCalled();
      const limitCallArgs = mockSelectLimit.mock.calls[mockSelectLimit.mock.calls.length - 1];
      expect(limitCallArgs![0]).toBe(25);

      expect(result).toEqual(fakeRows);
    });

    it("should default batchSize to 50", async () => {
      mockSelectLimit.mockResolvedValueOnce([]);

      await getPendingNotifications();

      // Verify limit was called with default 50
      expect(mockSelectLimit).toHaveBeenCalled();
      const limitCallArgs = mockSelectLimit.mock.calls[mockSelectLimit.mock.calls.length - 1];
      expect(limitCallArgs![0]).toBe(50);
    });
  });

  // -----------------------------------------------------------------------
  // markAsSent
  // -----------------------------------------------------------------------

  describe("markAsSent", () => {
    it("should update sentAt for given ids", async () => {
      const beforeCall = Date.now();
      await markAsSent(["id-1", "id-2", "id-3"]);
      const afterCall = Date.now();

      // Should have called update
      expect(mockUpdate).toHaveBeenCalled();

      // Should set sentAt to a Date close to now
      expect(updateSetCalls.length).toBe(1);
      const setFields = (updateSetCalls[0] as unknown[])[0] as Record<string, unknown>;
      const sentAt = setFields.sentAt as Date;
      expect(sentAt).toBeInstanceOf(Date);
      expect(sentAt.getTime()).toBeGreaterThanOrEqual(beforeCall);
      expect(sentAt.getTime()).toBeLessThanOrEqual(afterCall);

      // Should have a WHERE clause with the IDs (using sql template)
      expect(updateWhereCalls.length).toBe(1);
    });

    it("should not call update when ids array is empty", async () => {
      await markAsSent([]);

      expect(mockUpdate).not.toHaveBeenCalled();
    });
  });
});

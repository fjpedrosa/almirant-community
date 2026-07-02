import { afterAll, describe, expect, it, mock, beforeEach } from "bun:test";
import { createLoggerMock, restoreRealModules } from "../test/mocks";

// ---------------------------------------------------------------------------
// Module-level mock kept minimal; dependency injection handles the rest.
// ---------------------------------------------------------------------------

mock.module("@almirant/config", () => createLoggerMock());

// ---------------------------------------------------------------------------
// Types (imported dynamically below)
// ---------------------------------------------------------------------------

type SweeperDeps = import("../domains/notifications/services/notification-sweeper").SweeperDeps;
type RunOnce = (cfg?: { intervalMs?: number; batchSize?: number }, deps?: SweeperDeps) => Promise<void>;

// ---------------------------------------------------------------------------
// Helpers: fake NotificationQueueDb rows with proper payloads
// ---------------------------------------------------------------------------

const makeAssignmentNotification = (overrides: Record<string, unknown> = {}) => ({
  id: `notif-${Math.random().toString(36).slice(2, 8)}`,
  workspaceId: "org-1",
  recipientUserId: "user-1",
  type: "assignment" as const,
  debounceKey: "key-assign-1",
  payload: {
    ideaItemId: "idea-1",
    ideaItemTitle: "Test Idea",
    assignerName: "Admin",
  },
  scheduledAt: new Date("2025-01-01T00:00:00Z"),
  sentAt: null,
  createdAt: new Date("2025-01-01T00:00:00Z"),
  ...overrides,
});

const makeCommentNotification = (overrides: Record<string, unknown> = {}) => ({
  id: `notif-${Math.random().toString(36).slice(2, 8)}`,
  workspaceId: "org-1",
  recipientUserId: "user-1",
  type: "comment" as const,
  debounceKey: "key-comment-1",
  payload: {
    ideaItemId: "idea-2",
    ideaItemTitle: "Commented Idea",
    commentContent: "Great work!",
    commenterName: "Reviewer",
  },
  scheduledAt: new Date("2025-01-01T00:00:00Z"),
  sentAt: null,
  createdAt: new Date("2025-01-01T00:00:00Z"),
  ...overrides,
});

const makeStatusChangedNotification = (overrides: Record<string, unknown> = {}) => ({
  id: `notif-${Math.random().toString(36).slice(2, 8)}`,
  workspaceId: "org-1",
  recipientUserId: "user-1",
  type: "status_changed" as const,
  debounceKey: "key-status-1",
  payload: {
    title: "Quota warning",
    body: "Usage is close to the configured limit.",
    itemLink: "/settings/quota",
  },
  scheduledAt: new Date("2025-01-01T00:00:00Z"),
  sentAt: null,
  createdAt: new Date("2025-01-01T00:00:00Z"),
  ...overrides,
});

// ---------------------------------------------------------------------------
// Create a fresh deps object for each test (dependency injection)
// ---------------------------------------------------------------------------

const noop = () => {};
const noopLogger = { info: noop, warn: noop, error: noop, debug: noop };

const createMockDeps = () => {
  const _getPendingNotifications = mock(() => Promise.resolve([] as any[]));
  const _markAsSent = mock(() => Promise.resolve(undefined as void));
  const _isEmailConfigured = mock(() => true);
  const _sendEmail = mock(() =>
    Promise.resolve({ success: true } as { success: boolean; error?: string })
  );
  const _buildAssignmentEmail = mock((_name: string, _items: unknown[]) => ({
    subject: "Assignment subject",
    html: "<p>assignment</p>",
  }));
  const _buildCommentEmail = mock((_name: string, _items: unknown[]) => ({
    subject: "Comment subject",
    html: "<p>comment</p>",
  }));
  const _buildMentionEmail = mock((_name: string, _items: unknown[]) => ({
    subject: "Mention subject",
    html: "<p>mention</p>",
  }));
  const _buildStatusChangedEmail = mock((_name: string, _items: unknown[]) => ({
    subject: "Status subject",
    html: "<p>status</p>",
  }));
  const _lookupRecipient = mock(() =>
    Promise.resolve({ name: "Test User", email: "test@example.com", locale: "en" } as {
      name: string;
      email: string;
      locale: string;
    } | null)
  );

  const deps: SweeperDeps = {
    getPendingNotifications: _getPendingNotifications as any,
    markAsSent: _markAsSent as any,
    isEmailConfigured: _isEmailConfigured as any,
    sendEmail: _sendEmail as any,
    buildAssignmentEmail: _buildAssignmentEmail as any,
    buildCommentEmail: _buildCommentEmail as any,
    buildMentionEmail: _buildMentionEmail as any,
    buildStatusChangedEmail: _buildStatusChangedEmail as any,
    lookupRecipient: _lookupRecipient as any,
    logger: noopLogger,
  };

  return {
    deps,
    mocks: {
      getPendingNotifications: _getPendingNotifications,
      markAsSent: _markAsSent,
      isEmailConfigured: _isEmailConfigured,
      sendEmail: _sendEmail,
      buildAssignmentEmail: _buildAssignmentEmail,
      buildCommentEmail: _buildCommentEmail,
      buildMentionEmail: _buildMentionEmail,
      buildStatusChangedEmail: _buildStatusChangedEmail,
      lookupRecipient: _lookupRecipient,
    },
  };
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("runNotificationSweeperOnce", () => {
  let runNotificationSweeperOnce: RunOnce;
  let deps: SweeperDeps;
  let m: ReturnType<typeof createMockDeps>["mocks"];

  beforeEach(async () => {
    // Dynamic import so mock.module() stubs take effect for transitive deps
    const mod = await import("../domains/notifications/services/notification-sweeper");
    runNotificationSweeperOnce = mod.runNotificationSweeperOnce;

    // Fresh mocks via dependency injection (no mock.module flakiness)
    const created = createMockDeps();
    deps = created.deps;
    m = created.mocks;
  });

  // -----------------------------------------------------------------------
  // 1. Guard: email not configured
  // -----------------------------------------------------------------------

  it("should not process if email is not configured", async () => {
    m.isEmailConfigured.mockReturnValue(false);

    await runNotificationSweeperOnce(undefined, deps);

    expect(m.getPendingNotifications).not.toHaveBeenCalled();
    expect(m.markAsSent).not.toHaveBeenCalled();
    expect(m.sendEmail).not.toHaveBeenCalled();
  });

  // -----------------------------------------------------------------------
  // 2. No pending notifications
  // -----------------------------------------------------------------------

  it("should do nothing when no pending notifications", async () => {
    m.getPendingNotifications.mockResolvedValue([]);

    await runNotificationSweeperOnce(undefined, deps);

    expect(m.getPendingNotifications).toHaveBeenCalledTimes(1);
    expect(m.sendEmail).not.toHaveBeenCalled();
    expect(m.markAsSent).not.toHaveBeenCalled();
  });

  // -----------------------------------------------------------------------
  // 3. Group by (recipientUserId, type)
  // -----------------------------------------------------------------------

  it("should group notifications by recipientUserId and type", async () => {
    const notifications = [
      makeAssignmentNotification({ id: "n1", recipientUserId: "user-1" }),
      makeAssignmentNotification({ id: "n2", recipientUserId: "user-1" }),
      makeCommentNotification({ id: "n3", recipientUserId: "user-1" }),
      makeAssignmentNotification({ id: "n4", recipientUserId: "user-2" }),
    ];
    m.getPendingNotifications.mockResolvedValue(notifications);

    await runNotificationSweeperOnce(undefined, deps);

    // 3 groups: (user-1, assignment), (user-1, comment), (user-2, assignment)
    expect(m.sendEmail).toHaveBeenCalledTimes(3);
  });

  // -----------------------------------------------------------------------
  // 4. Do not mark as sent if sendEmail fails
  // -----------------------------------------------------------------------

  it("should not mark as sent if sendEmail fails", async () => {
    const notifications = [
      makeAssignmentNotification({ id: "n1", recipientUserId: "user-1" }),
    ];
    m.getPendingNotifications.mockResolvedValue(notifications);
    m.sendEmail.mockResolvedValue({ success: false, error: "SMTP error" });

    await runNotificationSweeperOnce(undefined, deps);

    expect(m.sendEmail).toHaveBeenCalledTimes(1);
    expect(m.markAsSent).not.toHaveBeenCalled();
  });

  // -----------------------------------------------------------------------
  // 5. Mark as sent on successful email
  // -----------------------------------------------------------------------

  it("should mark as sent on successful email", async () => {
    const notifications = [
      makeAssignmentNotification({ id: "n1", recipientUserId: "user-1" }),
      makeAssignmentNotification({ id: "n2", recipientUserId: "user-1" }),
    ];
    m.getPendingNotifications.mockResolvedValue(notifications);
    m.sendEmail.mockResolvedValue({ success: true });

    await runNotificationSweeperOnce(undefined, deps);

    expect(m.markAsSent).toHaveBeenCalledTimes(1);
    expect(m.markAsSent).toHaveBeenCalledWith(["n1", "n2"]);
  });

  // -----------------------------------------------------------------------
  // 6. Build correct assignment email
  // -----------------------------------------------------------------------

  it("should build correct assignment email with extracted payload items", async () => {
    const notifications = [
      makeAssignmentNotification({
        id: "n1",
        recipientUserId: "user-1",
        payload: {
          ideaItemId: "idea-42",
          ideaItemTitle: "Implement feature X",
          assignerName: "Alice",
        },
      }),
    ];
    m.getPendingNotifications.mockResolvedValue(notifications);

    await runNotificationSweeperOnce(undefined, deps);

    expect(m.buildAssignmentEmail).toHaveBeenCalledTimes(1);
    expect(m.buildAssignmentEmail).toHaveBeenCalledWith(
      "Test User",
      [
        {
          ideaItemId: "idea-42",
          ideaItemTitle: "Implement feature X",
          assignerName: "Alice",
          itemLink: undefined,
        },
      ],
      "en"
    );
    expect(m.buildCommentEmail).not.toHaveBeenCalled();
  });

  // -----------------------------------------------------------------------
  // 7. Build correct comment email
  // -----------------------------------------------------------------------

  it("should build correct comment email with extracted payload items", async () => {
    const notifications = [
      makeCommentNotification({
        id: "n1",
        recipientUserId: "user-1",
        payload: {
          ideaItemId: "idea-99",
          ideaItemTitle: "Design review",
          commentContent: "Looks good to me!",
          commenterName: "Bob",
        },
      }),
    ];
    m.getPendingNotifications.mockResolvedValue(notifications);

    await runNotificationSweeperOnce(undefined, deps);

    expect(m.buildCommentEmail).toHaveBeenCalledTimes(1);
    expect(m.buildCommentEmail).toHaveBeenCalledWith(
      "Test User",
      [
        {
          ideaItemId: "idea-99",
          ideaItemTitle: "Design review",
          commentContent: "Looks good to me!",
          commenterName: "Bob",
          itemLink: undefined,
        },
      ],
      "en"
    );
    expect(m.buildAssignmentEmail).not.toHaveBeenCalled();
  });

  it("should unwrap JSON-stringified comment payload fields", async () => {
    const notifications = [
      makeCommentNotification({
        id: "n1",
        recipientUserId: "user-1",
        payload: {
          ideaItemId: "idea-100",
          ideaItemTitle: "Encoded payload",
          commentContent: JSON.stringify("<p>Contenido</p>"),
          commenterName: "Bob",
          itemLink: JSON.stringify("/ideas?id=idea-100"),
        },
      }),
    ];
    m.getPendingNotifications.mockResolvedValue(notifications);

    await runNotificationSweeperOnce(undefined, deps);

    expect(m.buildCommentEmail).toHaveBeenCalledWith(
      "Test User",
      [
        {
          ideaItemId: "idea-100",
          ideaItemTitle: "Encoded payload",
          commentContent: "<p>Contenido</p>",
          commenterName: "Bob",
          itemLink: "/ideas?id=idea-100",
        },
      ],
      "en"
    );
  });

  // -----------------------------------------------------------------------
  // 8. Skip group when recipient has no email
  // -----------------------------------------------------------------------

  it("should skip group when recipient has no email", async () => {
    const notifications = [
      makeAssignmentNotification({ id: "n1", recipientUserId: "user-no-email" }),
    ];
    m.getPendingNotifications.mockResolvedValue(notifications);
    m.lookupRecipient.mockResolvedValue({
      name: "No Email User",
      email: null as any,
      locale: "en",
    });

    await runNotificationSweeperOnce(undefined, deps);

    expect(m.sendEmail).not.toHaveBeenCalled();
    expect(m.markAsSent).not.toHaveBeenCalled();
  });

  // -----------------------------------------------------------------------
  // 9. Skip group when recipient user not found
  // -----------------------------------------------------------------------

  it("should skip group when recipient user not found", async () => {
    const notifications = [
      makeAssignmentNotification({ id: "n1", recipientUserId: "user-missing" }),
    ];
    m.getPendingNotifications.mockResolvedValue(notifications);
    m.lookupRecipient.mockResolvedValue(null);

    await runNotificationSweeperOnce(undefined, deps);

    expect(m.sendEmail).not.toHaveBeenCalled();
    expect(m.markAsSent).not.toHaveBeenCalled();
  });

  // -----------------------------------------------------------------------
  // 10. Mixed success/failure across groups
  // -----------------------------------------------------------------------

  it("should only mark successful groups as sent when some fail", async () => {
    const notifications = [
      makeAssignmentNotification({ id: "n1", recipientUserId: "user-1" }),
      makeAssignmentNotification({ id: "n2", recipientUserId: "user-2" }),
    ];
    m.getPendingNotifications.mockResolvedValue(notifications);

    let callCount = 0;
    m.sendEmail.mockImplementation(() => {
      callCount++;
      if (callCount === 1) return Promise.resolve({ success: true });
      return Promise.resolve({ success: false, error: "quota exceeded" });
    });

    await runNotificationSweeperOnce(undefined, deps);

    expect(m.sendEmail).toHaveBeenCalledTimes(2);
    expect(m.markAsSent).toHaveBeenCalledTimes(1);
    expect(m.markAsSent).toHaveBeenCalledWith(["n1"]);
  });

  // -----------------------------------------------------------------------
  // 11. Sends email with correct to, subject, html
  // -----------------------------------------------------------------------

  it("should send email with correct recipient, subject, and html", async () => {
    const notifications = [
      makeAssignmentNotification({ id: "n1", recipientUserId: "user-1" }),
    ];
    m.getPendingNotifications.mockResolvedValue(notifications);
    m.buildAssignmentEmail.mockReturnValue({
      subject: "You have a new assignment",
      html: "<p>Hello</p>",
    });

    await runNotificationSweeperOnce(undefined, deps);

    expect(m.sendEmail).toHaveBeenCalledWith({
      to: "test@example.com",
      subject: "You have a new assignment",
      html: "<p>Hello</p>",
    });
  });

  it("should build status change email with extracted payload items", async () => {
    const notifications = [
      makeStatusChangedNotification({
        id: "n-status-1",
        recipientUserId: "user-1",
        payload: {
          title: "Quota warning",
          body: "Anthropic usage reached 90%.",
          itemLink: "/settings/quota",
        },
      }),
    ];
    m.getPendingNotifications.mockResolvedValue(notifications);

    await runNotificationSweeperOnce(undefined, deps);

    expect(m.buildStatusChangedEmail).toHaveBeenCalledTimes(1);
    expect(m.buildStatusChangedEmail).toHaveBeenCalledWith(
      "Test User",
      [
        {
          title: "Quota warning",
          body: "Anthropic usage reached 90%.",
          itemLink: "/settings/quota",
        },
      ],
      "en"
    );
  });

  // -----------------------------------------------------------------------
  // 12. Respects batchSize config
  // -----------------------------------------------------------------------

  it("should pass batchSize to getPendingNotifications", async () => {
    await runNotificationSweeperOnce({ batchSize: 100 }, deps);

    expect(m.getPendingNotifications).toHaveBeenCalledWith(100);
  });

  it("should default batchSize to 50", async () => {
    await runNotificationSweeperOnce(undefined, deps);

    expect(m.getPendingNotifications).toHaveBeenCalledWith(50);
  });

  // -----------------------------------------------------------------------
  // 13. Skip group when payload has invalid/missing fields
  // -----------------------------------------------------------------------

  it("should skip group when assignment payload is missing required fields", async () => {
    const notifications = [
      makeAssignmentNotification({
        id: "n1",
        recipientUserId: "user-1",
        payload: { ideaItemId: "idea-1" }, // missing ideaItemTitle and assignerName
      }),
    ];
    m.getPendingNotifications.mockResolvedValue(notifications);

    await runNotificationSweeperOnce(undefined, deps);

    expect(m.buildAssignmentEmail).not.toHaveBeenCalled();
    expect(m.sendEmail).not.toHaveBeenCalled();
    expect(m.markAsSent).not.toHaveBeenCalled();
  });
});

afterAll(() => {
  mock.restore();
  restoreRealModules();
});

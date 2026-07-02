import { afterEach, beforeAll, describe, expect, it, mock } from "bun:test";

const state = {
  broadcasts: [] as Array<{ workspaceId: string; message: Record<string, unknown> }>,
};

mock.module("./ws-connection-manager", () => ({
  wsConnectionManager: {
    broadcastToWorkspace: (workspaceId: string, message: Record<string, unknown>) => {
      state.broadcasts.push({ workspaceId, message });
    },
  },
}));

let feedbackEvents: Awaited<typeof import("./feedback-events")>;

beforeAll(async () => {
  feedbackEvents = await import("./feedback-events");
});

afterEach(() => {
  state.broadcasts = [];
});

describe("feedback realtime events", () => {
  it("broadcasts feedback item updates using workspaceId from metadata when no explicit org is provided", () => {
    feedbackEvents.broadcastFeedbackItemUpdated({
      item: {
        id: "feedback-1",
        metadata: { workspaceId: "org-1" },
      },
      changes: { status: "triaged", aiDomain: undefined },
    });

    expect(state.broadcasts).toEqual([
      {
        workspaceId: "org-1",
        message: {
          type: "feedback-item:updated",
          payload: {
            feedbackItemId: "feedback-1",
            changes: { status: "triaged" },
          },
        },
      },
    ]);
  });

  it("broadcasts feedback comment events when a workspace is available", () => {
    feedbackEvents.broadcastFeedbackCommentCreated({
      feedbackItemId: "feedback-2",
      commentId: "comment-1",
      workspaceId: "org-2",
    });

    expect(state.broadcasts).toEqual([
      {
        workspaceId: "org-2",
        message: {
          type: "feedback-comment:created",
          payload: {
            feedbackItemId: "feedback-2",
            commentId: "comment-1",
          },
        },
      },
    ]);
  });
});

import { describe, expect, it, mock } from "bun:test";
import { render, screen, fireEvent } from "@testing-library/react";
import { ReleaseApprovalModal } from "./release-approval-modal";
import type { IntegrationBatchWithItems } from "../../domain/types";

const baseBatch: IntegrationBatchWithItems = {
  id: "batch-1",
  workspaceId: "org-1",
  projectId: "proj-1",
  repositoryId: "repo-1",
  boardId: "board-1",
  integrationBranch: "integration/batch-1",
  baseBranch: "main",
  status: "awaiting_release",
  triggeredByUserId: "user-1",
  currentItemIndex: 0,
  sandboxContainerId: null,
  finalPrUrl: null,
  finalPrNumber: null,
  errorMessage: null,
  startedAt: "2026-01-01T00:00:00Z",
  completedAt: null,
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-01T00:00:00Z",
  items: [
    {
      id: "item-1",
      batchId: "batch-1",
      workItemId: "wi-1",
      prNumber: 42,
      prUrl: "https://github.com/x/y/pull/42",
      branchName: "feature/foo",
      processingOrder: 0,
      status: "merged",
      failureCategory: null,
      failureReason: null,
      commitShaBefore: "abc",
      commitShaAfter: "def",
      migrationRegenerated: false,
      startedAt: "2026-01-01T00:00:00Z",
      completedAt: "2026-01-01T00:01:00Z",
    },
    {
      id: "item-2",
      batchId: "batch-1",
      workItemId: "wi-2",
      prNumber: 43,
      prUrl: "https://github.com/x/y/pull/43",
      branchName: "feature/bar",
      processingOrder: 1,
      status: "skipped",
      failureCategory: "schema_semantic",
      failureReason: "rename collided with add column",
      commitShaBefore: null,
      commitShaAfter: null,
      migrationRegenerated: false,
      startedAt: null,
      completedAt: null,
    },
  ],
};

describe("ReleaseApprovalModal", () => {
  it("renders item count summary (merged vs skipped)", () => {
    render(
      <ReleaseApprovalModal
        batch={baseBatch}
        isPending={false}
        onApprove={() => {}}
        onReject={() => {}}
        onClose={() => {}}
      />,
    );
    expect(screen.getByText(/1.*merged/i)).toBeDefined();
    expect(screen.getByText(/1.*skipped/i)).toBeDefined();
  });

  it("lists each item with its PR number", () => {
    render(
      <ReleaseApprovalModal
        batch={baseBatch}
        isPending={false}
        onApprove={() => {}}
        onReject={() => {}}
        onClose={() => {}}
      />,
    );
    expect(screen.getByText(/#42/)).toBeDefined();
    expect(screen.getByText(/#43/)).toBeDefined();
  });

  it("calls onApprove when Approve clicked", () => {
    const onApprove = mock(() => {});
    render(
      <ReleaseApprovalModal
        batch={baseBatch}
        isPending={false}
        onApprove={onApprove}
        onReject={() => {}}
        onClose={() => {}}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /approve/i }));
    expect(onApprove).toHaveBeenCalledTimes(1);
  });

  it("calls onReject when Reject clicked", () => {
    const onReject = mock(() => {});
    render(
      <ReleaseApprovalModal
        batch={baseBatch}
        isPending={false}
        onApprove={() => {}}
        onReject={onReject}
        onClose={() => {}}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /reject/i }));
    expect(onReject).toHaveBeenCalledTimes(1);
  });

  it("disables both buttons while pending", () => {
    render(
      <ReleaseApprovalModal
        batch={baseBatch}
        isPending={true}
        onApprove={() => {}}
        onReject={() => {}}
        onClose={() => {}}
      />,
    );
    expect(screen.getByRole("button", { name: /approve/i })).toHaveProperty(
      "disabled",
      true,
    );
    expect(screen.getByRole("button", { name: /reject/i })).toHaveProperty(
      "disabled",
      true,
    );
  });

  it("shows the failure reason for skipped items", () => {
    render(
      <ReleaseApprovalModal
        batch={baseBatch}
        isPending={false}
        onApprove={() => {}}
        onReject={() => {}}
        onClose={() => {}}
      />,
    );
    expect(screen.getByText(/rename collided with add column/i)).toBeDefined();
  });
});

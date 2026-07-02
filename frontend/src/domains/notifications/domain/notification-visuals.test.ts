import { describe, expect, it } from "bun:test";
import {
  getNotificationToastTypeFromMetadata,
  getNotificationVisual,
} from "./notification-visuals";
import type { Notification } from "./types";

const createNotification = (
  prState: "merged" | "open" | "closed",
  metadata: Record<string, unknown> = {}
): Notification => ({
  id: `notification-${prState}`,
  recipientUserId: "user-1",
  workspaceId: "org-1",
  type: "status_changed",
  title: `PR ${prState}`,
  body: null,
  link: null,
  sourceEntityType: "github_pr:42",
  sourceEntityId: "repo-1",
  actorUserId: null,
  isRead: false,
  readAt: null,
  metadata: {
    kind: "github_pr_lifecycle",
    prState,
    ...metadata,
  },
  createdAt: "2026-04-15T16:00:00.000Z",
  actor: null,
});

describe("notification-visuals", () => {
  it("pinta los estados de ciclo de vida de PR con colores distintos segun prState", () => {
    const mergedVisual = getNotificationVisual(createNotification("merged"));
    const openVisual = getNotificationVisual(createNotification("open", { prDraft: false }));
    const closedVisual = getNotificationVisual(createNotification("closed"));

    expect(mergedVisual.rowClass).toContain("violet");
    expect(mergedVisual.iconClass).toContain("violet");
    expect(mergedVisual.unreadDotClass).toContain("violet");

    expect(openVisual.rowClass).toContain("emerald");
    expect(openVisual.iconClass).toContain("emerald");
    expect(openVisual.unreadDotClass).toContain("emerald");

    expect(closedVisual.rowClass).toContain("red");
    expect(closedVisual.iconClass).toContain("red");
    expect(closedVisual.unreadDotClass).toContain("red");
  });

  it("pinta PR open draft en gris y PR open listo para review en verde", () => {
    const draftVisual = getNotificationVisual(
      createNotification("open", { prDraft: true })
    );
    const readyForReviewVisual = getNotificationVisual(
      createNotification("open", { prDraft: false })
    );

    expect(draftVisual.rowClass).toContain("slate");
    expect(draftVisual.iconClass).toContain("slate");
    expect(draftVisual.unreadDotClass).toContain("slate");

    expect(readyForReviewVisual.rowClass).toContain("emerald");
    expect(readyForReviewVisual.iconClass).toContain("emerald");
    expect(readyForReviewVisual.unreadDotClass).toContain("emerald");
  });

  it("resuelve el tipo de toast correcto para los estados de PR", () => {
    const baseMetadata = { kind: "github_pr_lifecycle" };

    expect(
      getNotificationToastTypeFromMetadata({
        ...baseMetadata,
        prState: "closed",
      })
    ).toBe("error");
    expect(
      getNotificationToastTypeFromMetadata({
        ...baseMetadata,
        prState: "open",
        prDraft: true,
      })
    ).toBe("neutral");
    expect(
      getNotificationToastTypeFromMetadata({
        ...baseMetadata,
        prState: "open",
        prDraft: false,
      })
    ).toBe("success");
    expect(
      getNotificationToastTypeFromMetadata({
        ...baseMetadata,
        prState: "merged",
      })
    ).toBe("merged");
  });
});

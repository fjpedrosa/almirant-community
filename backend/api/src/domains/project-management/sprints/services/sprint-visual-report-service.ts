import { logger } from "@almirant/config";
import {
  createDocument,
  getAttachmentsByWorkItem,
  getBoardByIdInternal,
  getSprintDocumentRefByKind,
  getSprintMajorityProjectId,
  getSprintWorkItems,
  getWorkItemById,
  linkDocumentToWorkItem,
  setSprintDocumentForKind,
  SPRINT_DOCUMENT_KIND_VISUAL_REPORT,
  updateDocument,
} from "@almirant/database";
import type {
  SprintReportScreenshotsSection,
  SprintReportScreenshotGroup,
  SprintReportScreenshot,
} from "@almirant/database";

type WorkItemTypeLite = "epic" | "feature" | "story" | "task" | "idea";

const isImageAttachment = (args: { mimeType?: string | null; fileName: string }): boolean => {
  const mt = (args.mimeType ?? "").toLowerCase();
  if (mt.startsWith("image/")) return true;
  const name = args.fileName.toLowerCase();
  return name.endsWith(".png") || name.endsWith(".jpg") || name.endsWith(".jpeg") || name.endsWith(".webp");
};

const safeCaption = (s: string): string => s.replace(/\s+/g, " ").trim();

const resolveGroupForWorkItem = async (
  workItemId: string
): Promise<{ groupId: string; groupTaskId: string | null; groupTitle: string; groupType: WorkItemTypeLite }> => {
  const self = await getWorkItemById(workItemId);
  if (!self) {
    return {
      groupId: workItemId,
      groupTaskId: null,
      groupTitle: "Item",
      groupType: "task",
    };
  }

  if (self.type === "epic" || self.type === "feature" || self.type === "story") {
    return {
      groupId: self.id,
      groupTaskId: self.taskId ?? null,
      groupTitle: self.title,
      groupType: self.type,
    };
  }

  if (!self.parent?.id) {
    return {
      groupId: self.id,
      groupTaskId: self.taskId ?? null,
      groupTitle: self.title,
      groupType: self.type,
    };
  }

  const parent = await getWorkItemById(self.parent.id);
  if (!parent) {
    return {
      groupId: self.id,
      groupTaskId: self.taskId ?? null,
      groupTitle: self.title,
      groupType: self.type,
    };
  }

  if (parent.type === "epic" || parent.type === "feature") {
    return {
      groupId: parent.id,
      groupTaskId: parent.taskId ?? null,
      groupTitle: parent.title,
      groupType: parent.type,
    };
  }

  // If we're under a story, try one level up to hit the feature/epic.
  if (parent.type === "story" && parent.parent?.id) {
    const grandParent = await getWorkItemById(parent.parent.id);
    if (grandParent && (grandParent.type === "epic" || grandParent.type === "feature")) {
      return {
        groupId: grandParent.id,
        groupTaskId: grandParent.taskId ?? null,
        groupTitle: grandParent.title,
        groupType: grandParent.type,
      };
    }
  }

  return {
    groupId: parent.id,
    groupTaskId: parent.taskId ?? null,
    groupTitle: parent.title,
    groupType: parent.type,
  };
};

export const buildSprintScreenshotsSection = async (args: {
  workspaceId: string;
  sprintId: string;
  completedItems: Array<{ workItemId: string; taskId: string | null; title: string }>;
}): Promise<SprintReportScreenshotsSection | null> => {
  const docRef = await getSprintDocumentRefByKind(args.sprintId, SPRINT_DOCUMENT_KIND_VISUAL_REPORT);

  const groupMap = new Map<string, SprintReportScreenshotGroup>();
  let total = 0;

  // Note: keep this best-effort; any failure in evidence generation must not break the report.
  await Promise.all(
    args.completedItems.map(async (item) => {
      const attachments = await getAttachmentsByWorkItem(
        args.workspaceId,
        item.workItemId,
      );
      const images = attachments.filter((a) =>
        isImageAttachment({ mimeType: a.mimeType ?? null, fileName: a.fileName })
      );
      if (images.length === 0) return;

      const group = await resolveGroupForWorkItem(item.workItemId);
      const key = group.groupId;
      if (!groupMap.has(key)) {
        groupMap.set(key, {
          groupId: group.groupId,
          groupTaskId: group.groupTaskId,
          groupTitle: group.groupTitle,
          groupType: group.groupType,
          screenshots: [],
        });
      }

      const g = groupMap.get(key)!;
      for (const img of images) {
        const caption = safeCaption(
          `${item.taskId ?? ""} ${item.title} - ${img.fileName}`.trim()
        );
        const entry: SprintReportScreenshot = {
          workItemId: item.workItemId,
          workItemTaskId: item.taskId,
          workItemTitle: item.title,
          imageUrl: img.fileUrl,
          caption,
        };
        g.screenshots.push(entry);
        total += 1;
      }
    })
  );

  if (total === 0) return null;

  const groups = Array.from(groupMap.values()).sort((a, b) => {
    const at = `${a.groupTaskId ?? ""} ${a.groupTitle}`.trim();
    const bt = `${b.groupTaskId ?? ""} ${b.groupTitle}`.trim();
    return at.localeCompare(bt);
  });

  return {
    total,
    groups,
    document: docRef ? { id: docRef.id, title: docRef.title } : null,
  };
};

const renderVisualReportMarkdown = (args: {
  sprintName: string;
  evidence: SprintReportScreenshotsSection;
}): string => {
  const lines: string[] = [];
  lines.push(`# Reporte visual: ${args.sprintName}`);
  lines.push("");
  lines.push(`Total screenshots: ${args.evidence.total}`);
  lines.push("");

  for (const group of args.evidence.groups) {
    const groupLabel = `${group.groupTaskId ?? ""} ${group.groupTitle}`.trim();
    lines.push(`## ${groupLabel || "Item"}`);
    lines.push("");

    for (const s of group.screenshots) {
      // Markdown image + caption (caption as text helps readability).
      lines.push(`![${s.caption}](${s.imageUrl})`);
      lines.push("");
      lines.push(`_${s.caption}_`);
      lines.push("");
    }
  }

  return lines.join("\n");
};

export const upsertSprintVisualReportDocument = async (args: {
  sprintId: string;
  boardId: string;
  sprintName: string;
  completedItems: Array<{ workItemId: string; taskId: string | null; title: string }>;
}): Promise<{ documentId: string } | null> => {
  try {
    const board = await getBoardByIdInternal(args.boardId);
    const workspaceId = board?.workspaceId;
    if (!workspaceId) {
      logger.warn({ boardId: args.boardId }, "Cannot upsert sprint visual report: board not found");
      return null;
    }

    const evidence = await buildSprintScreenshotsSection({
      workspaceId,
      sprintId: args.sprintId,
      completedItems: args.completedItems,
    });
    if (!evidence) return null;

    const projectId = await getSprintMajorityProjectId(workspaceId, args.sprintId);

    const title = `Reporte visual - ${args.sprintName}`;
    const content = renderVisualReportMarkdown({ sprintName: args.sprintName, evidence });

    const existing = await getSprintDocumentRefByKind(args.sprintId, SPRINT_DOCUMENT_KIND_VISUAL_REPORT);

    if (existing) {
      await updateDocument(workspaceId, existing.id, { title, content, projectId });
      return { documentId: existing.id };
    }

    const created = await createDocument(workspaceId, { title, content, projectId: projectId ?? undefined });
    if (!created) return null;

    await setSprintDocumentForKind({
      sprintId: args.sprintId,
      documentId: created.id,
      kind: SPRINT_DOCUMENT_KIND_VISUAL_REPORT,
    });

    // Best-effort: link the document to the completed work items for navigation.
    await Promise.all(
      args.completedItems.map(async (item) => {
        try {
          await linkDocumentToWorkItem(created.id, item.workItemId);
        } catch {
          // Ignore duplicate link errors or transient issues
        }
      })
    );

    return { documentId: created.id };
  } catch (error) {
    logger.error(error, "Failed to upsert sprint visual report document");
    return null;
  }
};

export const kickoffSprintVisualReportGeneration = (args: {
  sprintId: string;
  boardId: string;
  sprintName: string;
}): void => {
  // Fire-and-forget: visual report is best-effort and must not block sprint closing.
  getBoardByIdInternal(args.boardId)
    .then(async (board) => {
      const workspaceId = board?.workspaceId;
      if (!workspaceId) {
        logger.warn({ boardId: args.boardId }, "Cannot kickoff visual report: board not found");
        return;
      }
      const items = await getSprintWorkItems(workspaceId, args.sprintId);
      return upsertSprintVisualReportDocument({
        sprintId: args.sprintId,
        boardId: args.boardId,
        sprintName: args.sprintName,
        completedItems: items
          .filter((i) => i.completedAt !== null)
          .map((i) => ({
            workItemId: i.workItemId,
            taskId: i.taskId ?? null,
            title: i.title,
          })),
      });
    })
    .catch((error) => {
      logger.error(error, "Failed to kickoff sprint visual report generation");
    });
};

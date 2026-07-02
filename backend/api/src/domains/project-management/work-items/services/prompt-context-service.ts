import {
  getWorkItemById,
  getProjectById,
  getBoardByIdInternal,
  getWorkItems,
} from "@almirant/database";
import { logger } from "@almirant/config";

export interface WorkItemContext {
  workItem: {
    id: string;
    taskId: string | null;
    title: string;
    description: string | null;
    type: string;
    priority: string;
    definitionOfDone: string | null;
    dodApproved: boolean;
    dodIncompleted: boolean;
    dodReport: string | null;
    dodReviewedAt: string | null;
    previewUrl?: string | null;
    walkthrough?: {
      status: string;
      viewport: string;
      targetUrl?: string;
      currentScript?: { content: string; version: number; approvedAt?: string };
      recordingsCount: number;
      initiatedAt: string;
      completedAt?: string;
    } | null;
  };
  parent: {
    id: string;
    title: string;
    type: string;
    description?: string | null;
  } | null;
  siblings: {
    taskId: string | null;
    title: string;
    type: string;
    priority: string;
    columnName: string | null;
  }[];
  project: {
    name: string;
    description: string | null;
    techStack: string[];
    repositories: { name: string; url: string; isMonorepo: boolean }[];
  } | null;
  board: {
    name: string;
    workflow: string[];
  } | null;
}

export const gatherWorkItemContext = async (
  workItemId: string,
  workspaceId: string
): Promise<WorkItemContext | null> => {
  const workItem = await getWorkItemById(workItemId);
  if (!workItem) return null;

  const metadata = workItem.metadata as Record<string, unknown> | null;

  // Gather project and board context in parallel
  const [projectData, boardData, siblingsData] = await Promise.all([
    workItem.projectId ? getProjectById(workspaceId, workItem.projectId) : null,
    getBoardByIdInternal(workItem.boardId),
    workItem.parentId
      ? getWorkItems(
          workspaceId,
          { page: 1, limit: 50, offset: 0 },
          { parentId: workItem.parentId }
        ).then((r) => r.items.filter((i) => i.id !== workItemId))
      : Promise.resolve([]),
  ]);

  const walkthroughRaw = metadata?.walkthrough as Record<string, unknown> | undefined;
  const walkthroughContext = walkthroughRaw
    ? {
        status: (walkthroughRaw.status as string) ?? "draft",
        viewport: (walkthroughRaw.viewport as string) ?? "desktop",
        targetUrl: (walkthroughRaw.targetUrl as string) ?? undefined,
        currentScript: walkthroughRaw.currentScript
          ? {
              content: ((walkthroughRaw.currentScript as Record<string, unknown>).content as string) ?? "",
              version: ((walkthroughRaw.currentScript as Record<string, unknown>).version as number) ?? 1,
              approvedAt: ((walkthroughRaw.currentScript as Record<string, unknown>).approvedAt as string) ?? undefined,
            }
          : undefined,
        recordingsCount: Array.isArray(walkthroughRaw.recordings) ? walkthroughRaw.recordings.length : 0,
        initiatedAt: (walkthroughRaw.initiatedAt as string) ?? "",
        completedAt: (walkthroughRaw.completedAt as string) ?? undefined,
      }
    : null;

  const context: WorkItemContext = {
    workItem: {
      id: workItem.id,
      taskId: workItem.taskId,
      title: workItem.title,
      description: workItem.description,
      type: workItem.type,
      priority: workItem.priority,
      definitionOfDone: (metadata?.definitionOfDone as string) ?? null,
      dodApproved: metadata?.dod_approved === true,
      dodIncompleted: metadata?.dod_incompleted === true,
      dodReport: typeof metadata?.dod_report === "string" ? metadata.dod_report : null,
      dodReviewedAt: typeof metadata?.dod_reviewed_at === "string" ? metadata.dod_reviewed_at : null,
      previewUrl: (metadata?.previewUrl as string) ?? null,
      walkthrough: walkthroughContext,
    },
    parent: workItem.parent
      ? {
          id: workItem.parent.id,
          title: workItem.parent.title,
          type: workItem.parent.type,
          description: (workItem.parent as Record<string, unknown>).description as string | null ?? null,
        }
      : null,
    siblings: siblingsData.map((s) => ({
      taskId: s.taskId,
      title: s.title,
      type: s.type,
      priority: s.priority,
      columnName: s.columnName,
    })),
    project: projectData
      ? {
          name: projectData.name,
          description: projectData.description,
          techStack: (projectData.techStack as string[]) ?? [],
          repositories: projectData.repositories.map((r) => ({
            name: r.name,
            url: r.url,
            isMonorepo: r.isMonorepo,
          })),
        }
      : null,
    board: boardData
      ? {
          name: boardData.name,
          workflow: boardData.columns.map((c) => c.name),
        }
      : null,
  };

  logger.info(
    {
      workItemId,
      hasProject: !!context.project,
      siblingsCount: context.siblings.length,
      hasParent: !!context.parent,
    },
    "Gathered work item context for prompt generation"
  );

  return context;
};

export const buildEnrichedPromptInput = (context: WorkItemContext): string => {
  const sections: string[] = [];

  // Work item info
  sections.push(`# Work Item: ${context.workItem.title}`);
  sections.push(`Type: ${context.workItem.type} | Priority: ${context.workItem.priority}`);
  if (context.workItem.taskId) {
    sections.push(`ID: ${context.workItem.taskId}`);
  }

  if (context.workItem.description) {
    sections.push(`\n## Description\n${context.workItem.description}`);
  }

  if (context.workItem.definitionOfDone) {
    sections.push(
      `\n## Definition of Done\n${context.workItem.definitionOfDone}`
    );
  }

  if (context.workItem.dodIncompleted && context.workItem.dodReport) {
    sections.push(`\n## Previous Definition of Done Review`);
    sections.push(`Status: incomplete`);
    if (context.workItem.dodReviewedAt) {
      sections.push(`Reviewed at: ${context.workItem.dodReviewedAt}`);
    }
    sections.push(`Report:\n${context.workItem.dodReport}`);
  }

  // Preview URL
  if (context.workItem.previewUrl) {
    sections.push(`\nPreview URL: ${context.workItem.previewUrl}`);
  }

  // Walkthrough context
  if (context.workItem.walkthrough) {
    const wt = context.workItem.walkthrough;
    sections.push(`\n## Walkthrough`);
    sections.push(`Status: ${wt.status} | Viewport: ${wt.viewport}`);
    if (wt.targetUrl) {
      sections.push(`Target URL: ${wt.targetUrl}`);
    }
    if (wt.currentScript) {
      sections.push(`Current Script (v${wt.currentScript.version}${wt.currentScript.approvedAt ? ", approved" : ""}):`);
      sections.push(wt.currentScript.content);
    }
    if (wt.recordingsCount > 0) {
      sections.push(`Existing recordings: ${wt.recordingsCount}`);
    }
  }

  // Project context
  if (context.project) {
    sections.push(`\n## Project Context`);
    sections.push(`Project: ${context.project.name}`);
    if (context.project.description) {
      sections.push(`Description: ${context.project.description}`);
    }
    if (context.project.techStack.length > 0) {
      sections.push(`Tech Stack: ${context.project.techStack.join(", ")}`);
    }
    if (context.project.repositories.length > 0) {
      const repos = context.project.repositories
        .map(
          (r) =>
            `- ${r.name}: ${r.url}${r.isMonorepo ? " (monorepo)" : ""}`
        )
        .join("\n");
      sections.push(`Repositories:\n${repos}`);
    }
  }

  // Parent feature context
  if (context.parent) {
    sections.push(
      `\n## Parent ${context.parent.type}: ${context.parent.title}`
    );
  }

  // Sibling tasks (related tasks under the same parent)
  if (context.siblings.length > 0) {
    sections.push(`\n## Related Tasks (same parent)`);
    for (const s of context.siblings) {
      const id = s.taskId ? `${s.taskId}: ` : "";
      sections.push(
        `- ${id}${s.title} [${s.type}/${s.priority}] → ${s.columnName}`
      );
    }
  }

  // Board workflow
  if (context.board) {
    sections.push(
      `\n## Board Workflow: ${context.board.workflow.join(" → ")}`
    );
  }

  return sections.join("\n");
};

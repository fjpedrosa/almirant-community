import { ChatOpenAI } from "@langchain/openai";
import { SystemMessage, HumanMessage } from "@langchain/core/messages";
import { env, logger } from "@almirant/config";
import {
  createDocument,
  getBoardByIdInternal,
  getSprintDocumentRefByKind,
  getSprintMajorityProjectId,
  getSprintWorkItems,
  getWorkItemsByIds,
  setSprintDocumentForKind,
  SPRINT_DOCUMENT_KIND_CHANGELOG,
  updateDocument,
} from "@almirant/database";
import { localeToLanguageName } from "../../../ai/shared/services/locale-utils";

// ---------------------------------------------------------------------------
// OpenAI singleton
// ---------------------------------------------------------------------------

let chatModel: ChatOpenAI | null = null;

const getChatModel = (): ChatOpenAI => {
  if (!chatModel) {
    chatModel = new ChatOpenAI({
      openAIApiKey: env.OPENAI_API_KEY!,
      modelName: env.OPENAI_MODEL,
    });
  }
  return chatModel;
};

const isAiConfigured = (): boolean => !!env.OPENAI_API_KEY;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type FallbackStrategy = "list-only" | "ai-analyze" | "skip";

interface ItemDocumentation {
  summary: string;
  screenshots: string[];
  mermaidDiagrams?: string[];
}

interface ChangelogGroup {
  groupId: string;
  groupTitle: string;
  groupType: string;
  groupTaskId: string | null;
  items: Array<{
    taskId: string | null;
    title: string;
    type: string;
    description: string | null;
    documentation: ItemDocumentation | null;
  }>;
}

// ---------------------------------------------------------------------------
// Locale-aware labels
// ---------------------------------------------------------------------------

const getLabels = (locale: string) => {
  const isEs = locale.startsWith("es");
  return {
    independentTasks: isEs ? "Tareas independientes" : "Standalone tasks",
    summaryUnavailable: isEs ? "_Resumen no disponible._" : "_Summary not available._",
    mainChanges: isEs ? "**Cambios principales:**" : "**Main changes:**",
    visualChanges: isEs ? "**Cambios visuales:**" : "**Visual changes:**",
    architecture: isEs ? "**Arquitectura:**" : "**Architecture:**",
  };
};

// ---------------------------------------------------------------------------
// Grouping logic
// ---------------------------------------------------------------------------

const groupItemsByParent = async (
  organizationId: string,
  completedWorkItemIds: string[],
  locale: string = "es"
): Promise<ChangelogGroup[]> => {
  if (completedWorkItemIds.length === 0) return [];

  const workItems = await getWorkItemsByIds(organizationId, completedWorkItemIds);
  const workItemMap = new Map(workItems.map((wi) => [wi.id, wi]));

  const groupMap = new Map<string, ChangelogGroup>();
  const independentKey = "__independent__";
  const labels = getLabels(locale);

  for (const id of completedWorkItemIds) {
    const wi = workItemMap.get(id);
    if (!wi) continue;

    // Walk up to find parent feature/epic
    let groupId = independentKey;
    let groupTitle = labels.independentTasks;
    let groupType = "independent";
    let groupTaskId: string | null = null;

    if (wi.parent) {
      const parent = workItemMap.get(wi.parent.id);
      // Check if parent is in our fetched set, otherwise use the relation data
      const parentType = parent?.type ?? wi.parent.type;
      const parentTitle = parent?.title ?? wi.parent.title;
      const parentTaskId = parent?.taskId ?? null;

      if (parentType === "epic" || parentType === "feature") {
        groupId = wi.parent.id;
        groupTitle = parentTitle;
        groupType = parentType;
        groupTaskId = parentTaskId;
      } else if (parentType === "story" && parent?.parent) {
        // Go one level up from story to reach feature/epic
        const grandparent = workItemMap.get(parent.parent.id);
        const gpType = grandparent?.type ?? parent.parent.type;
        const gpTitle = grandparent?.title ?? parent.parent.title;
        const gpTaskId = grandparent?.taskId ?? null;

        if (gpType === "epic" || gpType === "feature") {
          groupId = parent.parent.id;
          groupTitle = gpTitle;
          groupType = gpType;
          groupTaskId = gpTaskId;
        } else {
          groupId = wi.parent.id;
          groupTitle = parentTitle;
          groupType = parentType;
          groupTaskId = parentTaskId;
        }
      } else {
        groupId = wi.parent.id;
        groupTitle = parentTitle;
        groupType = parentType;
        groupTaskId = parentTaskId;
      }
    }

    if (!groupMap.has(groupId)) {
      groupMap.set(groupId, {
        groupId,
        groupTitle,
        groupType,
        groupTaskId,
        items: [],
      });
    }

    // Extract documentation from metadata if available
    const rawDoc = (wi.metadata as Record<string, unknown>)?.documentation as
      | { summary?: string; screenshots?: string[]; mermaidDiagrams?: string[] }
      | undefined;
    const documentation: ItemDocumentation | null =
      rawDoc?.summary
        ? {
            summary: rawDoc.summary,
            screenshots: rawDoc.screenshots ?? [],
            mermaidDiagrams: rawDoc.mermaidDiagrams,
          }
        : null;

    groupMap.get(groupId)!.items.push({
      taskId: wi.taskId ?? null,
      title: wi.title,
      type: wi.type,
      description: wi.description ?? null,
      documentation,
    });
  }

  // Sort: features/epics first, independent last
  return Array.from(groupMap.values()).sort((a, b) => {
    if (a.groupId === independentKey) return 1;
    if (b.groupId === independentKey) return -1;
    const aLabel = `${a.groupTaskId ?? ""} ${a.groupTitle}`.trim();
    const bLabel = `${b.groupTaskId ?? ""} ${b.groupTitle}`.trim();
    return aLabel.localeCompare(bLabel);
  });
};

// ---------------------------------------------------------------------------
// AI summary generation
// ---------------------------------------------------------------------------

const generateGroupSummary = async (
  group: ChangelogGroup,
  locale: string = "es"
): Promise<string> => {
  const langName = localeToLanguageName(locale);

  const itemsList = group.items
    .map((item) => {
      const prefix = item.taskId ? `[${item.taskId}]` : "-";
      const desc = item.documentation?.summary
        ? `\n  Review summary: ${item.documentation.summary}`
        : item.description
          ? `\n  Description: ${item.description.slice(0, 300)}`
          : "";
      return `${prefix} ${item.title} (${item.type})${desc}`;
    })
    .join("\n");

  const prompt = `Generate a brief narrative summary (2-4 sentences) in ${langName} for the following group of tasks completed in a development sprint.

Feature/Group: ${group.groupTitle} (${group.groupType})

Completed tasks:
${itemsList}

The summary should:
- Explain WHAT was achieved clearly and concisely
- Mention the BENEFIT or impact of these changes
- Use a professional, results-oriented tone
- NOT include task IDs or unnecessary technical details
- Be readable for non-technical stakeholders

Respond ONLY with the summary text, no headings or extra formatting.`;

  const model = getChatModel();
  const response = await model.invoke([
    new SystemMessage(
      `You are an assistant that generates sprint summaries for a software development team. You write in ${langName}, clearly and professionally.`
    ),
    new HumanMessage(prompt),
  ]);

  return typeof response.content === "string"
    ? response.content.trim()
    : String(response.content).trim();
};

// ---------------------------------------------------------------------------
// Fallback (no AI) markdown
// ---------------------------------------------------------------------------

const renderItemDocumentation = (
  item: ChangelogGroup["items"][number],
  locale: string = "es"
): string[] => {
  const lines: string[] = [];
  if (!item.documentation) return lines;
  const labels = getLabels(locale);

  if (item.documentation.summary) {
    lines.push(`  > ${item.documentation.summary}`);
  }

  if (item.documentation.screenshots.length > 0) {
    lines.push("");
    lines.push(`  ${labels.visualChanges}`);
    for (const url of item.documentation.screenshots) {
      lines.push(`  ![Screenshot](${url})`);
    }
  }

  if (item.documentation.mermaidDiagrams && item.documentation.mermaidDiagrams.length > 0) {
    lines.push("");
    lines.push(`  ${labels.architecture}`);
    for (const diagram of item.documentation.mermaidDiagrams) {
      lines.push("  ```mermaid");
      lines.push(`  ${diagram.replace(/\n/g, "\n  ")}`);
      lines.push("  ```");
    }
  }

  return lines;
};

const shouldIncludeItem = (
  item: ChangelogGroup["items"][number],
  fallback: FallbackStrategy
): boolean => {
  if (item.documentation) return true; // always include documented items
  return fallback !== "skip";
};

const renderSimpleChangelog = (
  sprintName: string,
  groups: ChangelogGroup[],
  fallback: FallbackStrategy = "list-only",
  locale: string = "es"
): string => {
  const lines: string[] = [];
  lines.push(`# Changelog: ${sprintName}`);
  lines.push("");

  for (const group of groups) {
    const filteredItems = group.items.filter((i) => shouldIncludeItem(i, fallback));
    if (filteredItems.length === 0) continue;

    const label = group.groupTaskId
      ? `${group.groupTaskId} ${group.groupTitle}`
      : group.groupTitle;
    lines.push(`## ${label}`);
    lines.push("");
    for (const item of filteredItems) {
      const prefix = item.taskId ? `**${item.taskId}**` : "-";
      lines.push(`- ${prefix} ${item.title}`);
      const docLines = renderItemDocumentation(item, locale);
      if (docLines.length > 0) {
        lines.push(...docLines);
      }
    }
    lines.push("");
  }

  return lines.join("\n");
};

// ---------------------------------------------------------------------------
// AI-enriched markdown
// ---------------------------------------------------------------------------

const generateItemFallbackSummary = async (
  item: ChangelogGroup["items"][number],
  locale: string = "es"
): Promise<string | null> => {
  if (!isAiConfigured()) return null;
  const desc = item.description?.slice(0, 500) ?? "";
  if (!desc) return null;

  const langName = localeToLanguageName(locale);

  try {
    const model = getChatModel();
    const response = await model.invoke([
      new SystemMessage(
        `Generate a 1-2 sentence summary in ${langName} for this development work item.`
      ),
      new HumanMessage(`Title: ${item.title}\nType: ${item.type}\nDescription: ${desc}`),
    ]);
    const text = typeof response.content === "string"
      ? response.content.trim()
      : String(response.content).trim();
    return text || null;
  } catch {
    return null;
  }
};

const renderAiChangelog = async (
  sprintName: string,
  groups: ChangelogGroup[],
  fallback: FallbackStrategy = "list-only",
  locale: string = "es"
): Promise<string> => {
  const lines: string[] = [];
  const labels = getLabels(locale);
  lines.push(`# Changelog: ${sprintName}`);
  lines.push("");

  for (const group of groups) {
    const filteredItems = group.items.filter((i) => shouldIncludeItem(i, fallback));
    if (filteredItems.length === 0) continue;

    const label = group.groupTaskId
      ? `${group.groupTaskId} ${group.groupTitle}`
      : group.groupTitle;
    lines.push(`## ${label}`);
    lines.push("");

    try {
      const summary = await generateGroupSummary(group, locale);
      lines.push(summary);
    } catch (error) {
      logger.error(error, `Failed to generate AI summary for group ${group.groupTitle}`);
      lines.push(labels.summaryUnavailable);
    }
    lines.push("");

    lines.push(labels.mainChanges);
    lines.push("");
    for (const item of filteredItems) {
      const prefix = item.taskId ? `**${item.taskId}**` : "-";
      lines.push(`- ${prefix} ${item.title}`);

      if (item.documentation) {
        const docLines = renderItemDocumentation(item, locale);
        if (docLines.length > 0) {
          lines.push(...docLines);
        }
      } else if (fallback === "ai-analyze") {
        const aiSummary = await generateItemFallbackSummary(item, locale);
        if (aiSummary) {
          lines.push(`  > ${aiSummary}`);
        }
      }
    }
    lines.push("");
  }

  return lines.join("\n");
};

// ---------------------------------------------------------------------------
// Document upsert
// ---------------------------------------------------------------------------

export const generateSprintChangelog = async (args: {
  sprintId: string;
  boardId: string;
  sprintName: string;
  fallbackStrategy?: FallbackStrategy;
  locale?: string;
}): Promise<{ documentId: string } | null> => {
  try {
    const fallback = args.fallbackStrategy ?? "list-only";
    const locale = args.locale ?? "es";

    const board = await getBoardByIdInternal(args.boardId);
    const organizationId = board?.organizationId;
    if (!organizationId) {
      logger.warn({ boardId: args.boardId }, "Cannot generate sprint changelog: board not found");
      return null;
    }

    const items = await getSprintWorkItems(organizationId, args.sprintId);
    const completedIds = items
      .filter((i) => i.completedAt !== null)
      .map((i) => i.workItemId);

    if (completedIds.length === 0) {
      logger.info("No completed items for sprint changelog, skipping");
      return null;
    }

    const groups = await groupItemsByParent(organizationId, completedIds, locale);
    if (groups.length === 0) return null;

    const projectId = await getSprintMajorityProjectId(organizationId, args.sprintId);

    const title = `Changelog - ${args.sprintName}`;
    const content = isAiConfigured()
      ? await renderAiChangelog(args.sprintName, groups, fallback, locale)
      : renderSimpleChangelog(args.sprintName, groups, fallback, locale);

    // Upsert: update existing or create new
    const existing = await getSprintDocumentRefByKind(
      args.sprintId,
      SPRINT_DOCUMENT_KIND_CHANGELOG
    );

    if (existing) {
      await updateDocument(organizationId, existing.id, {
        title,
        content,
        projectId,
      });
      return { documentId: existing.id };
    }

    const created = await createDocument(organizationId, { title, content, projectId: projectId ?? undefined });
    if (!created) return null;

    await setSprintDocumentForKind({
      sprintId: args.sprintId,
      documentId: created.id,
      kind: SPRINT_DOCUMENT_KIND_CHANGELOG,
    });

    return { documentId: created.id };
  } catch (error) {
    logger.error(error, "Failed to generate sprint changelog");
    return null;
  }
};

// ---------------------------------------------------------------------------
// Fire-and-forget entry point (matches kickoffSprintVisualReportGeneration)
// ---------------------------------------------------------------------------

export const kickoffSprintChangelogGeneration = (args: {
  sprintId: string;
  boardId: string;
  sprintName: string;
  locale?: string;
}): void => {
  generateSprintChangelog(args).catch((error) => {
    logger.error(error, "Failed to kickoff sprint changelog generation");
  });
};

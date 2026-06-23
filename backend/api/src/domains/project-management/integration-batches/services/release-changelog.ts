/**
 * Renders the body of a release Pull Request: a categorized changelog of the
 * work items integrated in a batch, plus a status table and an escalations
 * section.
 *
 * Pure-ish: the data loading helper is exposed separately so the renderer can
 * be unit-tested with synthetic snapshots.
 */

import { eq, inArray } from "drizzle-orm";
import {
  db,
  integrationBatches,
  listItemsByBatch,
  projects,
  workItems,
} from "@almirant/database";

const MAX_ITEMS_IN_BODY = 100;

export type ChangelogCategory = "feature" | "fix" | "other";

export interface ChangelogItem {
  workItemId: string;
  taskId: string | null;
  title: string;
  description: string | null;
  type: string;
  isBug: boolean;
  category: ChangelogCategory;
  prNumber: number | null;
  prUrl: string | null;
  itemStatus: string;
  failureCategory: string | null;
  failureReason: string | null;
  migrationRegenerated: boolean;
}

export interface ReleaseChangelogSnapshot {
  releaseNumber: number | null;
  integrationBranch: string;
  baseBranch: string;
  projectName: string;
  items: ChangelogItem[];
}

const CONVENTIONAL_PREFIX_RE = /^(?<type>feat|fix|refactor|chore|docs|test|perf|style|build|ci)(?:\([^)]*\))?:/i;

const stripConventionalPrefix = (title: string): string => {
  const match = title.match(CONVENTIONAL_PREFIX_RE);
  return match ? title.slice(match[0].length).trim() : title;
};

export const categorizeItem = (input: {
  type: string;
  title: string;
  isBug: boolean;
}): ChangelogCategory => {
  const match = input.title.match(CONVENTIONAL_PREFIX_RE);
  const conventional = match?.groups?.type?.toLowerCase();
  if (conventional === "feat") return "feature";
  if (conventional === "fix") return "fix";
  if (input.isBug) return "fix";
  if (input.type === "feature") return "feature";
  return "other";
};

export const loadReleaseChangelogSnapshot = async (
  batchId: string,
): Promise<ReleaseChangelogSnapshot | null> => {
  const [batch] = await db
    .select()
    .from(integrationBatches)
    .where(eq(integrationBatches.id, batchId))
    .limit(1);
  if (!batch) return null;

  const items = await listItemsByBatch(batchId);

  const workItemIds = items.map((it) => it.workItemId);
  const workItemRows = workItemIds.length
    ? await db
        .select({
          id: workItems.id,
          taskId: workItems.taskId,
          title: workItems.title,
          description: workItems.description,
          type: workItems.type,
          metadata: workItems.metadata,
        })
        .from(workItems)
        .where(inArray(workItems.id, workItemIds))
    : [];
  const workItemsById = new Map(workItemRows.map((w) => [w.id, w]));

  const [projectRow] = await db
    .select({ name: projects.name })
    .from(projects)
    .where(eq(projects.id, batch.projectId))
    .limit(1);

  const changelogItems: ChangelogItem[] = items.map((it) => {
    const wi = workItemsById.get(it.workItemId);
    const meta = (wi?.metadata as Record<string, unknown> | null) ?? null;
    const isBug = meta?.isBug === true;
    const type = wi?.type ?? "task";
    const title = wi?.title ?? "(unknown)";
    return {
      workItemId: it.workItemId,
      taskId: wi?.taskId ?? null,
      title,
      description: wi?.description ?? null,
      type,
      isBug,
      category: categorizeItem({ type, title, isBug }),
      prNumber: it.prNumber,
      prUrl: it.prUrl,
      itemStatus: it.status,
      failureCategory: it.failureCategory,
      failureReason: it.failureReason,
      migrationRegenerated: it.migrationRegenerated,
    };
  });

  return {
    releaseNumber: batch.releaseNumber,
    integrationBranch: batch.integrationBranch,
    baseBranch: batch.baseBranch,
    projectName: projectRow?.name ?? "(unknown project)",
    items: changelogItems,
  };
};

const truncate = (s: string | null | undefined, max: number): string => {
  if (!s) return "";
  const flat = s.replace(/\s+/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
};

const itemRefMd = (item: ChangelogItem): string => {
  const title = stripConventionalPrefix(item.title);
  const id = item.taskId ? `**${item.taskId}**` : `**(no-id)**`;
  const desc = truncate(item.description, 140);
  return desc ? `- ${id} ${title} — ${desc}` : `- ${id} ${title}`;
};

const statusEmoji = (status: string): string => {
  switch (status) {
    case "merged":
      return "✅ merged";
    case "failed":
      return "❌ failed";
    case "skipped":
      return "⏭ skipped";
    case "rebasing":
    case "migrating":
    case "type_checking":
    case "testing":
      return `⏳ ${status}`;
    default:
      return status;
  }
};

export const renderReleasePrBody = (snapshot: ReleaseChangelogSnapshot): string => {
  const v = snapshot.releaseNumber ?? "?";
  const limited = snapshot.items.slice(0, MAX_ITEMS_IN_BODY);
  const hidden = Math.max(0, snapshot.items.length - limited.length);

  const features = limited.filter((it) => it.category === "feature");
  const fixes = limited.filter((it) => it.category === "fix");
  const others = limited.filter((it) => it.category === "other");
  const escalated = limited.filter((it) => it.itemStatus === "failed");

  const lines: string[] = [];
  lines.push(`## 🚀 Release v${v} — ${snapshot.projectName}`);
  lines.push("");
  lines.push(
    `Release rama: \`${snapshot.integrationBranch}\` → \`${snapshot.baseBranch}\` (producción)`,
  );
  lines.push("");

  const pushSection = (
    title: string,
    items: ChangelogItem[],
  ): void => {
    if (items.length === 0) return;
    lines.push(`## ${title}`);
    for (const item of items) {
      lines.push(itemRefMd(item));
    }
    lines.push("");
  };

  pushSection("✨ Features", features);
  pushSection("🐛 Fixes", fixes);
  pushSection("🔧 Other", others);

  if (limited.length > 0) {
    lines.push("## 🚦 Items integrados");
    lines.push("");
    lines.push("| Task | PR | Estado | Migración |");
    lines.push("| ---- | -- | ------ | --------- |");
    for (const it of limited) {
      const id = it.taskId ?? "—";
      const pr = it.prNumber ? `#${it.prNumber}` : "—";
      const status = statusEmoji(it.itemStatus);
      const migration = it.migrationRegenerated ? "sí" : "—";
      lines.push(`| ${id} | ${pr} | ${status} | ${migration} |`);
    }
    lines.push("");
  }

  if (escalated.length > 0) {
    lines.push("## ⚠️ Items escalados");
    for (const it of escalated) {
      const id = it.taskId ?? "—";
      const reason = it.failureCategory ?? "unknown";
      const detail = truncate(it.failureReason, 120);
      lines.push(`- **${id}** — ${reason}${detail ? `: ${detail}` : ""}`);
    }
    lines.push("");
  }

  if (hidden > 0) {
    lines.push(`> +${hidden} más no mostrados (limitado a ${MAX_ITEMS_IN_BODY} por límite de body de PR de GitHub)`);
    lines.push("");
  }

  lines.push("---");
  lines.push("> Release PR creada y mantenida automáticamente por el integration runner de Almirant.");
  return lines.join("\n");
};

export const buildReleasePrTitle = (snapshot: ReleaseChangelogSnapshot): string => {
  const v = snapshot.releaseNumber ?? "?";
  return `[Release v${v}] ${snapshot.projectName}`;
};

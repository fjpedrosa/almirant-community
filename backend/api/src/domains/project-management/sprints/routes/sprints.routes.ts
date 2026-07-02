import { Elysia, t } from "elysia";
import { sessionContextTypes } from "../../../../shared/middleware/session-context-types.plugin";
import {
  getSprintById,
  getSprintWorkItemsExtended,
  getAiCostForWorkItems,
  getSprintUserContributionStats,
  getPreviousSprintsSummary,
  getSprintDocumentRefByKind,
  getDocumentById,
  SPRINT_DOCUMENT_KIND_CHANGELOG,
} from "@almirant/database";
import type { SprintReport, SprintWorkItemDetail } from "@almirant/database";
import {
  successResponse,
  notFoundResponse,
} from "../../../../shared/services/response";
import { buildSprintScreenshotsSection } from "../services/sprint-visual-report-service";

export const sprintsRoutes = new Elysia({ prefix: "/sprints" })
  .use(sessionContextTypes)

  // -------------------------------------------------------
  // GET /sprints/:id/report - Generate sprint report
  // -------------------------------------------------------
  .get(
    "/:id/report",
    async ({ params, query, set, activeWorkspace }) => {
      const orgId = activeWorkspace!.id;
      // 1. Get the sprint (org-scoped via board ownership)
      const sprint = await getSprintById(orgId, params.id);
      if (!sprint) {
        set.status = 404;
        return notFoundResponse("Sprint");
      }

      // 2. Get sprint work items with extended data (includes projectId)
      let allItems = await getSprintWorkItemsExtended(orgId, params.id);

      // 3. Filter by projectId if provided
      if (query.projectId) {
        allItems = allItems.filter(
          (item) => item.projectId === query.projectId
        );
      }

      // 4. Split into completed and carryover
      const completedItems = allItems.filter((item) => item.completedAt !== null);
      const carryoverItems = allItems.filter((item) => item.completedAt === null);

      // Strip projectId from items for the response (match SprintWorkItemDetail shape)
      const toDetail = (item: typeof allItems[number]): SprintWorkItemDetail => ({
        id: item.id,
        workItemId: item.workItemId,
        taskId: item.taskId ?? null,
        title: item.title,
        type: item.type,
        priority: item.priority,
        assignee: item.assignee,
        completedAt: item.completedAt,
      });

      // 5. Calculate velocity (tasks per day)
      const sprintStart = sprint.startDate ?? sprint.createdAt;
      const sprintEnd = sprint.closedAt ?? sprint.endDate ?? new Date();
      const durationMs = Math.max(
        new Date(sprintEnd).getTime() - new Date(sprintStart).getTime(),
        1 // avoid division by zero
      );
      const durationDays = durationMs / (1000 * 60 * 60 * 24);
      const velocity = durationDays > 0
        ? Math.round((completedItems.length / durationDays) * 100) / 100
        : 0;

      // 6. Calculate average time per task (hours from sprint start to completedAt)
      let averageTimePerTask = 0;
      if (completedItems.length > 0) {
        const startMs = new Date(sprintStart).getTime();
        const totalHours = completedItems.reduce((sum, item) => {
          const completedMs = new Date(item.completedAt!).getTime();
          const hoursToComplete = Math.max(
            (completedMs - startMs) / (1000 * 60 * 60),
            0
          );
          return sum + hoursToComplete;
        }, 0);
        averageTimePerTask =
          Math.round((totalHours / completedItems.length) * 100) / 100;
      }

      // 7. Distribution by type
      const distributionByType: Record<string, number> = {};
      for (const item of completedItems) {
        distributionByType[item.type] = (distributionByType[item.type] ?? 0) + 1;
      }

      // 8. Distribution by priority
      const distributionByPriority: Record<string, number> = {};
      for (const item of completedItems) {
        distributionByPriority[item.priority] =
          (distributionByPriority[item.priority] ?? 0) + 1;
      }

      // 9. Distribution by assignee
      const assigneeMap = new Map<string | null, number>();
      for (const item of completedItems) {
        const key = item.assignee;
        assigneeMap.set(key, (assigneeMap.get(key) ?? 0) + 1);
      }
      const distributionByAssignee = Array.from(assigneeMap.entries()).map(
        ([assignee, count]) => ({ assignee, count })
      );

      // 10. User contribution stats (created/assigned/completed)
      const userStats = await getSprintUserContributionStats(orgId, params.id);

      // 11. AI cost from ai_sessions for the sprint's work items
      const workItemIds = allItems.map((item) => item.workItemId);
      const aiCost = await getAiCostForWorkItems(workItemIds);

      // 12. Fetch previous sprints comparison data
      const compareCount = Math.min(
        Math.max(query.compareCount ? Number(query.compareCount) : 5, 1),
        10
      );
      const comparison = await getPreviousSprintsSummary(
        orgId,
        sprint.boardId,
        params.id,
        compareCount
      );

      // 13. Build report
      const report: SprintReport = {
        sprint,
        completedTasks: {
          count: completedItems.length,
          items: completedItems.map(toDetail),
        },
        carryoverTasks: {
          count: carryoverItems.length,
          items: carryoverItems.map(toDetail),
        },
        velocity,
        averageTimePerTask,
        distributionByType,
        distributionByPriority,
        distributionByAssignee,
        userStats,
        aiCost,
        comparison,
      };

        // 14. Optional screenshots section (evidence from image attachments on completed work items)
        try {
          const screenshots = await buildSprintScreenshotsSection({
            workspaceId: orgId,
            sprintId: params.id,
            completedItems: completedItems.map((i) => ({
              workItemId: i.workItemId,
              taskId: i.taskId ?? null,
            title: i.title,
          })),
        });
        if (screenshots) {
          report.screenshots = screenshots;
        }
      } catch {
        // Non-blocking: report should still be generated even if evidence fails.
      }

      // 15. Optional changelog section
      try {
        const changelogRef = await getSprintDocumentRefByKind(
          params.id,
          SPRINT_DOCUMENT_KIND_CHANGELOG
        );
        if (changelogRef) {
          const doc = await getDocumentById(activeWorkspace!.id, changelogRef.id);
          if (doc?.content) {
            report.changelog = doc.content;
          }
        }
      } catch {
        // Non-blocking: report should still be generated even if changelog fetch fails.
      }

      return successResponse(report);
    },
    {
      params: t.Object({
        id: t.String(),
      }),
      query: t.Object({
        projectId: t.Optional(t.String()),
        compareCount: t.Optional(t.Numeric({ minimum: 1, maximum: 10 })),
      }),
    }
  );

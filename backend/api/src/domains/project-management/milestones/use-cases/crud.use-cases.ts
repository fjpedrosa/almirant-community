import type { MilestoneRepository } from "../ports";

export const createMilestoneUseCases = (deps: { repo: MilestoneRepository }) => ({
  listByProject: (orgId: string, projectId: string) =>
    deps.repo.getByProject(orgId, projectId),

  getById: (orgId: string, id: string) =>
    deps.repo.getById(orgId, id),

  create: async (
    orgId: string,
    data: {
      projectId: string;
      title: string;
      description?: string | null;
      priority: "low" | "medium" | "high" | "urgent";
      targetDate?: string;
      workItemIds?: string[];
    },
    userId?: string
  ) => {
    const created = await deps.repo.create(orgId, {
      projectId: data.projectId,
      title: data.title,
      description: data.description ?? null,
      priority: data.priority,
      targetDate: data.targetDate ? new Date(data.targetDate) : null,
      createdByUserId: userId ?? null,
    });

    if (!created) return null;

    if (data.workItemIds && data.workItemIds.length > 0) {
      await deps.repo.addWorkItems(created.id, data.workItemIds);
    }

    // Return the full detail (with work items) after creation
    return deps.repo.getById(orgId, created.id);
  },

  update: async (
    orgId: string,
    id: string,
    data: {
      title?: string;
      description?: string | null;
      status?: "planned" | "in_progress" | "completed" | "on_hold" | "cancelled";
      priority?: "low" | "medium" | "high" | "urgent";
      targetDate?: string | null;
      completedAt?: string | null;
    }
  ) => {
    const updated = await deps.repo.update(orgId, id, {
      ...(data.title !== undefined ? { title: data.title } : {}),
      ...(data.description !== undefined ? { description: data.description } : {}),
      ...(data.status !== undefined ? { status: data.status } : {}),
      ...(data.priority !== undefined ? { priority: data.priority } : {}),
      ...(data.targetDate !== undefined
        ? { targetDate: data.targetDate ? new Date(data.targetDate) : null }
        : {}),
      ...(data.completedAt !== undefined
        ? { completedAt: data.completedAt ? new Date(data.completedAt) : null }
        : {}),
    });

    if (!updated) return null;

    // Return the full detail after update
    return deps.repo.getById(orgId, id);
  },

  delete: (orgId: string, id: string) => deps.repo.delete(orgId, id),

  addWorkItems: async (orgId: string, milestoneId: string, workItemIds: string[]) => {
    const milestone = await deps.repo.getById(orgId, milestoneId);
    if (!milestone) return null;

    const linked = await deps.repo.addWorkItems(milestoneId, workItemIds);
    const updated = await deps.repo.getById(orgId, milestoneId);

    return { linked, milestone: updated ?? milestone };
  },

  removeWorkItem: async (orgId: string, milestoneId: string, workItemId: string) => {
    const milestone = await deps.repo.getById(orgId, milestoneId);
    if (!milestone) return null;

    const removed = await deps.repo.removeWorkItem(milestoneId, workItemId);
    if (!removed) return { removed: false, milestone };

    const updated = await deps.repo.getById(orgId, milestoneId);
    return { removed: true, milestone: updated ?? milestone };
  },
});

export type MilestoneUseCases = ReturnType<typeof createMilestoneUseCases>;

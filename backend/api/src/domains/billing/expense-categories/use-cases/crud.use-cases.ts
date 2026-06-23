import type { ExpenseCategoryRepository } from "../ports";

export const createExpenseCategoryUseCases = (deps: { repo: ExpenseCategoryRepository }) => ({
  list: (orgId: string) => deps.repo.getAll(orgId),

  getById: (orgId: string, id: string) => deps.repo.getById(orgId, id),

  create: (orgId: string, data: {
    name: string;
    icon?: string | null;
    color?: string | null;
    order?: number;
    parentId?: string | null;
  }) => deps.repo.create(orgId, {
    name: data.name,
    icon: data.icon ?? null,
    color: data.color ?? null,
    order: data.order,
    parentId: data.parentId ?? null,
  }),

  update: (orgId: string, id: string, data: {
    name?: string;
    icon?: string | null;
    color?: string | null;
    order?: number;
    parentId?: string | null;
    isActive?: boolean;
  }) => deps.repo.update(orgId, id, data),

  delete: (orgId: string, id: string) => deps.repo.delete(orgId, id),
});

export type ExpenseCategoryUseCases = ReturnType<typeof createExpenseCategoryUseCases>;

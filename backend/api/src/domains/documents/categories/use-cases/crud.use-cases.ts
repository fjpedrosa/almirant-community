import type { DocumentCategoryRepository } from "../ports";

export const createDocumentCategoryUseCases = (deps: { repo: DocumentCategoryRepository }) => ({
  list: (orgId: string) => deps.repo.getAll(orgId),

  getById: (orgId: string, id: string) => deps.repo.getById(orgId, id),

  create: async (
    orgId: string,
    data: { name: string; color?: string; icon?: string; parentId?: string }
  ) => {
    if (!data.name || data.name.trim() === "") {
      return { error: "name_required" as const };
    }

    const category = await deps.repo.create(orgId, {
      name: data.name.trim(),
      color: data.color,
      icon: data.icon,
      parentId: data.parentId,
    });

    return { data: category };
  },

  update: (orgId: string, id: string, data: {
    name?: string;
    color?: string;
    icon?: string;
    parentId?: string | null;
    status?: "active" | "archived";
  }) => deps.repo.update(orgId, id, data),

  delete: (orgId: string, id: string) => deps.repo.delete(orgId, id),
});

export type DocumentCategoryUseCases = ReturnType<typeof createDocumentCategoryUseCases>;

import type { TagRepository } from "../ports";

export const createTagUseCases = (deps: { repo: TagRepository }) => ({
  list: (orgId: string) => deps.repo.getAll(orgId),

  getById: (orgId: string, id: string) => deps.repo.getById(orgId, id),

  create: async (orgId: string, data: { name: string; color?: string }) => {
    return deps.repo.create(orgId, { name: data.name.trim(), color: data.color });
  },

  update: (orgId: string, id: string, data: { name?: string; color?: string }) =>
    deps.repo.update(orgId, id, data),

  delete: (orgId: string, id: string) => deps.repo.delete(orgId, id),
});

export type TagUseCases = ReturnType<typeof createTagUseCases>;

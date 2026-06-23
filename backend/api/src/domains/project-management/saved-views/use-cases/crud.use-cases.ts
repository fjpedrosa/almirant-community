import type { SavedViewRepository, BoardRepository, ViewPreferenceRepository } from "../ports";

export const createSavedViewUseCases = (deps: {
  repo: SavedViewRepository;
  boardRepo: BoardRepository;
  prefRepo: ViewPreferenceRepository;
}) => ({
  // ── Board saved views ──

  listByBoard: async (userId: string, boardId: string, orgId: string) => {
    const board = await deps.boardRepo.getById(boardId, orgId);
    if (!board) return null;
    return deps.repo.getByBoard(userId, boardId);
  },

  create: async (
    userId: string,
    boardId: string,
    orgId: string,
    data: { name: string; config: Record<string, unknown> }
  ) => {
    const board = await deps.boardRepo.getById(boardId, orgId);
    if (!board) return { error: "board_not_found" as const };

    if (!data.name || data.name.trim() === "") {
      return { error: "name_required" as const };
    }

    const view = await deps.repo.create({
      userId,
      boardId,
      name: data.name.trim(),
      config: data.config,
    });

    return { data: view };
  },

  update: async (
    userId: string,
    boardId: string,
    viewId: string,
    data: { name?: string; config?: Record<string, unknown> }
  ) => {
    const existing = await deps.repo.getById(viewId);
    if (!existing) return { error: "not_found" as const };
    if (existing.userId !== userId) return { error: "forbidden" as const };
    if (existing.boardId !== boardId) return { error: "wrong_board" as const };

    const updated = await deps.repo.update(viewId, {
      name: data.name,
      config: data.config,
    });

    if (!updated) return { error: "not_found" as const };
    return { data: updated };
  },

  delete: async (userId: string, boardId: string, viewId: string) => {
    const existing = await deps.repo.getById(viewId);
    if (!existing) return { error: "not_found" as const };
    if (existing.userId !== userId) return { error: "forbidden" as const };
    if (existing.boardId !== boardId) return { error: "wrong_board" as const };

    const deleted = await deps.repo.delete(viewId);
    if (!deleted) return { error: "not_found" as const };
    return { data: { deleted: true } };
  },

  // ── User view preferences ──

  getPreference: (userId: string, pageKey: string) =>
    deps.prefRepo.get(userId, pageKey),

  upsertPreference: (userId: string, pageKey: string, config: Record<string, unknown>) =>
    deps.prefRepo.upsert(userId, pageKey, config),
});

export type SavedViewUseCases = ReturnType<typeof createSavedViewUseCases>;

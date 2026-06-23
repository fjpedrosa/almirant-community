export type SavedViewRepository = {
  getByBoard: (userId: string, boardId: string) => Promise<any[]>;
  getById: (id: string) => Promise<any | null>;
  create: (data: {
    userId: string;
    boardId: string;
    name: string;
    config: Record<string, unknown>;
  }) => Promise<any>;
  update: (id: string, data: { name?: string; config?: Record<string, unknown> }) => Promise<any | null>;
  delete: (id: string) => Promise<boolean>;
};

export type BoardRepository = {
  getById: (boardId: string, orgId: string) => Promise<any | null>;
};

export type ViewPreferenceRepository = {
  get: (userId: string, pageKey: string) => Promise<Record<string, unknown> | null>;
  upsert: (userId: string, pageKey: string, config: Record<string, unknown>) => Promise<void>;
};
